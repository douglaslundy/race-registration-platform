# Conciliação e sincronização de estorno externo

## Contexto

O botão de estornar pagamento (`RefundPaymentButton` no admin, `RefundRegistrationButton` no
organizador) chama `refundPayment()` (`lib/payment/refund-service.ts`), que só verifica se
`Payment.status === "PAID"` **localmente** antes de chamar o gateway para estornar. Se o pagamento
já tiver sido estornado (ou sofrido chargeback) diretamente no painel do gateway — sem passar pela
plataforma — o status local continua `PAID`, essa checagem passa, e o código tenta estornar de novo
no gateway. O gateway rejeita, a chamada lança uma exceção sem tratamento específico, a rota captura
genericamente e devolve o erro cru do gateway. Nada no banco é corrigido: `Payment`/`Order`
continuam `PAID`, a inscrição continua `CONFIRMED`, a vaga do lote continua ocupada — o sistema fica
defasado em relação ao que realmente aconteceu financeiramente.

Investigando o problema mais a fundo, foram encontrados dois outros pontos relacionados que também
fazem parte deste projeto:

1. **O webhook de pagamento já descarta esse cenário silenciosamente.** Em
   `app/api/webhooks/payment/route.ts`, a guarda `if (payment.status === "PAID" || payment.status
   === "REFUNDED") return NextResponse.json({ ok: true })` ignora **qualquer** webhook que chegue
   depois que o pagamento já está `PAID` — inclusive um webhook genuíno de `refunded` ou
   `charged_back`. Não há teste cobrindo essa transição.
2. **A conciliação (`reconcilePayments()`, `lib/payment/reconciliation.ts`) só reconsulta pagamentos
   `PENDING`.** Ela existe para achar pagamentos pendentes cujo webhook de aprovação/expiração foi
   perdido — mas não cobre pagamentos `PAID` que foram estornados/chargeback externamente, nem
   pagamentos `EXPIRED`/`CANCELLED` que na verdade foram aprovados no gateway mas cujo webhook nunca
   chegou (aprovação atrasada, cenário já tratado quando o webhook chega, mas não quando ele nunca
   chega).

## Escopo

Este projeto cobre exclusivamente a sincronização de status de pagamento entre o gateway e o banco
local, nos 3 pontos de entrada onde isso acontece (webhook, conciliação, botão de estornar). Fora de
escopo (tarefas separadas, já registradas): o modal de confirmação amigável para as telas de
cancelamento/estorno (troca do `alert()`/`confirm()`/`prompt()` nativos), a varredura geral do
sistema por `alert()`, e o botão de reenvio manual de notificação de pagamento não identificado.

## 1. Função compartilhada `applyGatewayStatus`

Novo módulo `lib/payment/sync-payment-status.ts`, exportando:

```ts
export async function applyGatewayStatus(
  tx: PrismaTransactionClient,
  payment: Payment,
  order: Order,
  registrations: Registration[],
  newStatus: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK",
  options?: { paidAt?: Date; rawPayload?: unknown },
): Promise<{ changed: boolean }>
```

Centraliza a lógica que hoje está inline no handler do webhook:

- **Order.status**: `PAID`→`PAID`, `REFUNDED`→`REFUNDED`, `CANCELLED`/`EXPIRED`→`CANCELLED`, senão
  mantém o atual.
- **Registration.status**: `PAID`→`CONFIRMED`, `CANCELLED`/`EXPIRED`→`CANCELLED`, **`REFUNDED`/
  `CHARGEBACK`→`CANCELLED` (novo — hoje não existe, é o gap que deixa a inscrição presa em
  `CONFIRMED` mesmo depois de um estorno)**.
- **Liberação de vaga** (`shouldReleaseCapacity`): `PENDING→CANCELLED/EXPIRED` (existente) **+
  `PAID→REFUNDED/CHARGEBACK` (novo)**.
- **Restauração de vaga** (`shouldRestoreCapacity`): `EXPIRED/CANCELLED→PAID` (existente, mantido).
- **Não-operação**: se `newStatus === payment.status` (webhook duplicado) ou se o status atual já é
  `REFUNDED`/`CHARGEBACK` (terminais de verdade, sem transição válida a partir deles), retorna
  `{ changed: false }` sem tocar no banco.
- **AuditLog**: sempre grava uma entrada quando `changed: true`. Ação `PAYMENT_WEBHOOK` quando
  chamado pelo webhook (mantém o nome atual); quando chamado pela conciliação, ação
  `PAYMENT_STATUS_SYNCED_RECONCILIATION`, `userId: null` (é uma correção automática do sistema, sem
  usuário que iniciou).
- **Não cria registro em `Refund`**: esse model exige `initiatedByUserId` (obrigatório, é quem
  iniciou o estorno pela plataforma). Uma correção detectada externamente não tem esse usuário — vira
  só `AuditLog`, mantendo `Refund` reservado para estornos que a própria plataforma processou.

`app/api/webhooks/payment/route.ts` passa a chamar essa função em vez de montar a transação inline.
A guarda de entrada muda de "ignora se já é PAID ou REFUNDED" para "ignora se o novo status é igual
ao atual, ou se o atual já é REFUNDED/CHARGEBACK" — deixando passar `PAID→REFUNDED`,
`PAID→CHARGEBACK` e mantendo o comportamento já existente para as demais transições.

## 2. Conciliação: duas varreduras novas

`reconcilePayments()` passa a rodar 3 passes (a primeira já existe e não muda):

1. **PENDING** (existente) — só alerta, sem correção automática (o cron de expiração e o webhook já
   são donos ativos dessa transição).
2. **PAID → gateway diz REFUNDED/CHARGEBACK** (novo) — verifica pagamentos `PAID` com
   `providerPaymentId` definido, dos últimos **90 dias** (`paidAt >= now - 90d`; janela para não
   escanear o histórico inteiro a cada execução — 90 dias cobre com folga o prazo típico de disputa
   de chargeback). Ao achar divergência, chama `applyGatewayStatus` (corrige sozinho) e registra a
   divergência com `corrected: true`.
3. **EXPIRED/CANCELLED → gateway diz PAID** (novo, aprovação atrasada sem webhook) — verifica
   pagamentos `EXPIRED`/`CANCELLED` dos últimos **7 dias** (`updatedAt >= now - 7d`; webhook atrasado
   costuma aparecer em horas/dias, não meses). Ao achar divergência, chama `applyGatewayStatus`
   (reativa pedido/inscrição, devolve a vaga) e registra com `corrected: true`.

`PaymentMismatch` (tipo exportado de `lib/payment/reconciliation.ts`) ganha o campo `corrected:
boolean`. `notifyReconciliationMismatches` (`lib/alerts/reconciliation.ts`) continua disparando
para toda divergência encontrada, corrigida ou não — o e-mail e a mensagem de WhatsApp passam a
distinguir "corrigido automaticamente" de "encontrado, precisa verificar manualmente". A tela
`/admin/conciliacao` reflete essa distinção na lista de divergências.

## 3. Botão de estornar: detectar estorno externo antes de chamar o gateway

`refundPayment()` (`lib/payment/refund-service.ts`) passa a consultar
`provider.checkPaymentStatus(payment.providerPaymentId)` antes de chamar
`provider.refundPayment()`:

- Se o gateway confirma `PAID` (o esperado) → segue o fluxo atual: chama o gateway para estornar de
  verdade, cria o registro em `Refund` (com `initiatedByUserId`), atualiza `Payment`/`Order`/
  `Registration`, libera a vaga, grava audit log — tudo como hoje.
- Se o gateway já diz `REFUNDED` ou `CHARGEBACK` → **não** chama `provider.refundPayment()` de novo.
  Em vez disso, chama `applyGatewayStatus` para sincronizar localmente, e a função retorna
  `{ alreadySynced: true }` em vez de completar um estorno "de verdade".

As rotas (`app/api/admin/payments/[id]/refund/route.ts` e
`app/api/organizer/registrations/[id]/refund/route.ts`) repassam essa informação na resposta JSON
(`{ success: true, alreadySynced: boolean }`), para que quem chamou possa diferenciar "estornado
agora" de "já estava estornado no gateway, sincronizamos". A parte visual dessa distinção (modal em
vez de `alert()`) é um projeto separado, já registrado na fila de tarefas.

## Testes

- `lib/payment/sync-payment-status.ts`: todas as transições (liberar vaga em `PAID→REFUNDED/
  CHARGEBACK`, restaurar vaga em `EXPIRED/CANCELLED→PAID`, no-op em status igual, bloqueio a partir
  de `REFUNDED`/`CHARGEBACK`).
- Webhook: novo teste confirmando que `PAID→REFUNDED` e `PAID→CHARGEBACK` agora são processados de
  verdade (cancelam a inscrição, liberam a vaga) — cenário hoje descartado silenciosamente.
- Conciliação: novos testes para as duas varreduras novas, confirmando a correção automática e o
  campo `corrected: true` no mismatch retornado.
- `refund-service.ts`: novo teste para o caminho "já reembolsado no gateway" — confirma que
  `provider.refundPayment()` **não** é chamado, que o estado local é sincronizado, e que a função
  retorna `{ alreadySynced: true }`.

## Fora de escopo

- Modal de confirmação amigável (telas de cancelamento/estorno) e a varredura geral por `alert()` —
  projetos separados.
- Botão de reenvio manual de notificação (e-mail/WhatsApp) de pagamento não identificado — projeto
  separado, já registrado na fila.
- Configuração via UI das janelas de 90/7 dias das novas varreduras da conciliação — hardcoded por
  ora, seguindo YAGNI; pode virar `PlatformSetting` configurável em uma iteração futura se
  necessário.
