# Design: cancelamento automático por prazo de pagamento vencido

Sub-projeto 9 de um conjunto maior de pedidos.

## ⚠️ Risco e mitigação

- **Bug pré-existente encontrado durante o brainstorming**: `TicketBatch.soldCount` é incrementado no momento do checkout (`lib/checkout.ts:147`), reservando a vaga antes de qualquer pagamento. Hoje, nenhuma rotina libera essa vaga quando o pagamento nunca acontece — nem o webhook do gateway (`app/api/webhooks/payment/route.ts`) decrementa `soldCount` ao receber `expired`/`cancelled`, nem existe nenhum cron para isso. Resultado: todo checkout abandonado deixa a vaga presa no lote para sempre. Esta mudança corrige isso.
- **Escolha deliberada de campo**: a nova rotina usa `Payment.expiresAt` (prazo real, vindo do gateway: ~30min PIX, ~3 dias boleto; já exibido nas telas do atleta e do admin) como fonte de verdade, **não** `Order.expiresAt` (fixo em 30 minutos, definido no checkout, órfão — não lido em nenhuma lógica hoje). Usar `Order.expiresAt` cancelaria boletos de 3 dias após só 30 minutos — um bug sério que este design evita deliberadamente.
- **Corrida cron vs. webhook duplicado**: um webhook do gateway pode ser reentregue (comportamento normal de at-least-once delivery), e o cron pode reprocessar o mesmo pagamento em execuções sucessivas. Mitigação: tanto o cron quanto o webhook só decrementam `soldCount` quando o status **anterior** era `PENDING` (guarda condicional via `updateMany` com `where: { status: "PENDING" }` no caso do cron; checagem do status pré-atualização já disponível no webhook) — depois da primeira transição, uma segunda tentativa não encontra mais `PENDING` e não repete a liberação da vaga.
- **Corrida cron vs. webhook atrasado (a mais sutil)**: o cron pode expirar um pagamento (liberando a vaga) bem perto do prazo, e um webhook de aprovação genuíno chegar atrasado depois. O webhook já reativa corretamente o pedido para `PAID`/`CONFIRMED` nesse caso — mas, sem tratamento adicional, a vaga liberada pelo cron ficaria perdida (uma vaga a menos do que deveria, risco de overselling). Mitigação: quando o webhook transiciona um pagamento de `EXPIRED`/`CANCELLED` para `PAID`, ele reincrementa `soldCount` das inscrições envolvidas, devolvendo a vaga.
- **Fora do escopo, aceito como limitação pré-existente**: cancelamento manual (organizador/admin) seguido de um webhook atrasado de aprovação não é tratado por este design — esse cenário já existia antes desta mudança e não é introduzido por ela.

## Contexto (o que já existe)

- `Payment.expiresAt` / `Order.expiresAt`: ambos `DateTime?`. `Order.expiresAt` é setado fixo em 30 minutos no checkout (`lib/checkout.ts:124`) e nunca mais lido em nenhuma lógica (só round-trip no backup). `Payment.expiresAt` vem da resposta real do gateway (`lib/payment/mercadopago.ts`, `lib/payment/pagarme.ts`, `lib/payment/sandbox.ts`) e é exibido ao atleta (`app/dashboard/inscricoes/[id]/page.tsx`) e ao admin (`app/admin/pagamentos/[id]/page.tsx`).
- `lib/checkout.ts:147`: `soldCount: { increment: 1 }` no `TicketBatch`, dentro da mesma transação que cria `Order`+`Registration`.
- Decremento de `soldCount` já existe em 3 lugares por cancelamento/estorno manual: `app/api/organizer/registrations/[id]/cancellation-decision/route.ts:51`, `app/api/registrations/[id]/cancel/route.ts:98`, `lib/payment/refund-service.ts:53` — todos fazem `soldCount: { decrement: 1 }`.
- `app/api/webhooks/payment/route.ts`: já mapeia `expired`/`cancelled` do gateway para `Payment → EXPIRED/CANCELLED`, `Order → CANCELLED`, `Registration → CANCELLED`, com `notifyPaymentError` disparado no final — mas **sem** tocar em `soldCount`.
- `lib/alerts/abandoned-cart.ts` / `POST /api/cron/abandoned-carts`: padrão de cron existente que só **alerta** (nunca cancela) quando um `Order` está `PENDING` há mais tempo que um limiar configurável — modelo de referência para a nova rota de cron, mas com uma diferença fundamental: este novo cron **age** (cancela de verdade), não só alerta.
- Sub-projeto anterior (conciliação de pagamentos): `reconcilePayments()` só considera `Payment` com `status: "PENDING"` — uma vez que um pagamento vira `EXPIRED` por esta nova rotina, ele automaticamente some do conjunto candidato da conciliação, sem conflito entre as duas features.
- `notifyPaymentError(paymentId)` (`lib/alerts/payment-error.ts`, já existente): usado hoje pelo webhook quando um pagamento é cancelado/expira; será reaproveitado aqui sem alteração.

## Decisões (confirmadas com o usuário)

1. Escopo cobre os dois pontos: novo cron proativo de cancelamento **e** correção do bug do webhook (que hoje não libera a vaga).
2. Além do cron automático, existe um gatilho manual — tanto para o admin (plataforma toda) quanto para o organizador (só os eventos dele), no mesmo padrão de escopo usado na conciliação de pagamentos.
3. A corrida rara "cron expira, webhook de aprovação chega atrasado" é tratada (reincrementa a vaga na reativação), não apenas documentada como risco aceito.

## Arquitetura

### Schema

Nenhuma mudança — todos os campos necessários (`Payment.expiresAt`, `Order.status`, `Registration.status`, `TicketBatch.soldCount`) já existem.

### Rotina central

Novo arquivo `lib/payment/expire-payments.ts`:

```ts
export async function cancelExpiredPayment(paymentId: string): Promise<boolean>
```

Dentro de uma transação:
1. `tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "EXPIRED" } })` — guarda condicional. Se `count === 0` (já processado por outra execução concorrente), a função retorna `false` sem mais nenhuma escrita.
2. Caso contrário: busca o `order` e suas `registrations` (com `ticketBatchId` e `status`) via o `paymentId`; atualiza `Order → CANCELLED`; para cada `Registration` cujo `status` ainda seja `PENDING_PAYMENT`, atualiza para `CANCELLED` e decrementa `TicketBatch.soldCount` (`{ decrement: 1 }`) do lote correspondente; grava `AuditLog` (`action: "PAYMENT_AUTO_EXPIRED"`, `entityType: "Payment"`, `entityId: paymentId`, `metadata: { orderId }`).
3. Retorna `true`.

Fora da transação, se o retorno foi `true`: dispara `notifyPaymentError(paymentId)` fire-and-forget (mesma função já usada pelo webhook).

```ts
export async function expirePendingPayments(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }>
```

Busca `Payment` com `status: "PENDING"`, `expiresAt: { not: null, lt: new Date() }`, e (quando `organizerUserId` é informado) filtra por `order.event.organizer.userId` — mesmo padrão de filtro opcional já usado em `reconcilePayments`. Para cada pagamento encontrado, chama `cancelExpiredPayment`; uma falha (exceção) num pagamento não interrompe o processamento dos demais (try/catch por item). Retorna `{ checked: <total encontrado>, expired: <quantos realmente foram cancelados> }`.

### Correção no webhook (`app/api/webhooks/payment/route.ts`)

Duas mudanças aditivas na função `POST`, sem alterar nenhuma lógica de mapeamento de status já existente:

1. **Liberar a vaga ao expirar/cancelar**: quando `newPaymentStatus` for `"CANCELLED"` ou `"EXPIRED"` **e** `payment.status` (o status ANTES desta atualização, já disponível na variável já buscada no início da função) for `"PENDING"`, inclui no array da transação já existente um `tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } })` para cada `Registration` do pedido. A guarda pelo status anterior evita decrementar duas vezes se o mesmo webhook for reentregue pelo gateway.
2. **Devolver a vaga se um webhook atrasado confirmar pagamento**: quando `newPaymentStatus` for `"PAID"` **e** `payment.status` (anterior) for `"EXPIRED"` ou `"CANCELLED"`, inclui no array da transação um `tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { increment: 1 } } })` para cada `Registration` do pedido — fecha a corrida cron-vs-webhook-atrasado descrita na seção de riscos.

### Rotas de disparo

- `POST /api/cron/expire-payments` — protegida por segredo (`x-cron-secret`/`CRON_SECRET`, mesmo padrão de `/api/cron/abandoned-carts` e `/api/cron/reconciliation`). Roda `expirePendingPayments()` sem filtro (plataforma toda).
- `POST /api/admin/expire-payments` — admin autenticado, roda sem filtro, retorna `{ checked, expired }` no corpo.
- `POST /api/organizer/expire-payments` — organizador (ou admin) autenticado, roda `expirePendingPayments({ organizerUserId: session.user.id })`, retorna o resultado escopado.

Nenhuma dessas rotas dispara alerta — diferente da conciliação (que sinaliza divergências para revisão humana), aqui a ação já é determinística e completa (o próprio `AuditLog` e o e-mail/WhatsApp de `notifyPaymentError` já servem de registro/aviso).

### UI

- Componente reutilizável `ExpirePaymentsPanel` (mesmo padrão do `ReconciliationPanel` do sub-projeto anterior: prop `endpoint`, botão "Processar agora", exibe `{ checked, expired }` após rodar).
- Páginas novas `/admin/pedidos-vencidos` e `/organizador/pedidos-vencidos`, cada uma usando o panel com o endpoint correspondente.
- Links novos em `AdminNav.tsx` e `OrganizerNav.tsx` (ambos os blocos do organizador, desktop e mobile).

### Rótulos

`lib/admin/labels.ts`: adiciona `PAYMENT_AUTO_EXPIRED: "Pagamento expirado automaticamente"` ao `ACTION_LABEL`.

## Fora de escopo

- Corrigir o cenário pré-existente "cancelamento manual + webhook de aprovação atrasado" (bug antigo, não introduzido por esta mudança).
- Qualquer alerta/notificação além do já existente `notifyPaymentError`.
- Alterar ou remover o campo órfão `Order.expiresAt` (fica como está, sem uso).
- Suporte a múltiplos `Payment` por `Order` (retry de pagamento) — hoje o checkout só cria um `Payment` por pedido; a rotina opera corretamente sob essa premissa atual.

## Testes

- Testes unitários para `cancelExpiredPayment`: guarda condicional (não age se o pagamento não estiver mais `PENDING`), cascata completa (`Order`→`CANCELLED`, `Registration`→`CANCELLED`, `soldCount` decrementado), `AuditLog` gravado com os campos corretos, `notifyPaymentError` disparado só quando a transação de fato mudou algo.
- Testes unitários para `expirePendingPayments`: filtro por `expiresAt` no passado e `status: "PENDING"`, filtro opcional por organizador, resiliência a falha parcial (um pagamento com erro não impede os demais).
- Testes para a correção do webhook: decremento de `soldCount` só quando o status anterior era `PENDING` (não decrementa duas vezes em reentrega), reincremento de `soldCount` só quando a transição é de `EXPIRED`/`CANCELLED` para `PAID` (não incrementa em uma aprovação normal vinda de `PENDING`).
- Testes de rota para as 3 rotas de disparo (autenticação/autorização, filtro por organizador, formato da resposta).
- Sem testes de UI (convenção já estabelecida).
- Verificação manual: um pagamento PIX de teste com `expiresAt` no passado sendo expirado pelo cron/botão manual, com `soldCount` do lote confirmadamente decrementado; simulação de webhook duplicado confirmando que a vaga não é decrementada duas vezes; simulação de webhook atrasado de aprovação após expiração automática confirmando que a vaga é devolvida.
