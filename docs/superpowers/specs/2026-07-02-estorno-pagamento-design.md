# Design: estorno de pagamento (Mercado Pago + Pagar.me)

Sub-projeto 4 de um conjunto maior de pedidos. Adiciona a capacidade de estornar um pagamento já pago, acionada manualmente pelo admin ou pelo organizador do evento — nunca automaticamente.

## ⚠️ Risco e mitigação

Esta é a primeira tarefa do conjunto que **move dinheiro de verdade** (via API de um gateway de pagamento real, quando `PAYMENT_PROVIDER` estiver configurado para `mercadopago` ou `pagarme` em produção). Mitigações do design:

- **Nunca automático.** Só existe via clique humano explícito (admin ou organizador do evento), com confirmação. Não há gatilho de cancelamento de atleta disparando estorno neste sub-projeto — essa decisão fica para o sub-projeto 5 (política de cancelamento), que vai decidir se/quando ligar isso.
- **Só estorno total.** Sem campo de valor parcial — reduz a superfície de erro numa operação financeira irreversível.
- **Ordem estrita de operações:** a chamada à API do gateway acontece primeiro; só se ela retornar sucesso é que o banco é alterado (registro de estorno criado, status atualizados). Se a chamada falhar, nada muda no banco — o erro é reportado ao usuário e ele pode tentar de novo.
- **Verificação com `PAYMENT_PROVIDER=sandbox`** antes de considerar a tarefa concluída — nenhum estorno real será disparado durante o desenvolvimento/verificação.
- **Não altera nenhuma rota existente de pagamento/checkout/cancelamento** — é só uma capacidade nova, chamada por dois pontos de entrada novos.

## Contexto (o que já existe)

- O Mercado Pago permite estorno via API, e o SDK já instalado (`mercadopago@2.12.1`) já expõe `PaymentRefund.create({ payment_id, body: { amount? } })` (sem `amount` = estorno total).
- O Pagar.me também permite: `DELETE https://api.pagar.me/core/v5/charges/{charge_id}`, com `amount` opcional no corpo (confirmado na documentação oficial). `lib/payment/pagarme.ts` já grava o `charge_id` do Pagar.me como `providerPaymentId` — o mesmo campo que o estorno vai usar.
- `PaymentProvider` (interface em `lib/payment/types.ts`, implementada por `MercadoPagoProvider`, `PagarMeProvider`, `SandboxPaymentProvider`) não tem método de estorno hoje.
- O model `Refund` existe (`paymentId`, `amount`, `reason`, `processedAt`), mas não registra quem iniciou o estorno.
- `Payment.status` e `Order.status` já têm `REFUNDED` no enum, sem nenhum código que os usa hoje.
- `/admin/pagamentos/[id]/page.tsx` já existe e já tem uma seção "estornos existentes" (hoje sempre vazia) — é o lugar natural para o botão do admin.
- A tabela de inscritos do organizador (`app/organizador/eventos/[id]/inscritos/page.tsx`, sub-projeto 1) não tem coluna de ações hoje.
- Os KPIs "Pagamentos cancelados" e "Estornos" (sub-projetos 2 e 3) já leem exatamente os campos que este sub-projeto vai popular corretamente — nenhuma mudança neles é necessária. Um pagamento com `Order.status = CANCELLED` e `Payment.status = PAID` aparece em "Pagamentos cancelados" (fila do que falta estornar); depois de estornado (`Payment.status = REFUNDED`, `Order.status = REFUNDED`), passa a aparecer em "Estornos" e some de "Pagamentos cancelados" — o ciclo de vida fecha sozinho.

## Decisões (confirmadas com o usuário)

1. Estorno real via API para **Mercado Pago e Pagar.me**. Sandbox simula sucesso instantâneo (sem chamada de rede).
2. Só estorno **total** — sem campo de valor parcial.
3. Botão "Estornar" também na **tabela de inscritos do organizador** (além do admin em `/admin/pagamentos/[id]`), restrito às inscrições dos próprios eventos.
4. Campo de **motivo opcional** (texto livre) ao confirmar o estorno, salvo no registro.

## Arquitetura

### Schema (migração nova, `prisma migrate`)

```prisma
model Refund {
  id                String    @id @default(cuid())
  paymentId         String
  amount            Int
  reason            String?
  providerRefundId  String?
  initiatedByUserId String
  processedAt       DateTime?
  createdAt         DateTime  @default(now())

  payment         Payment @relation(fields: [paymentId], references: [id])
  initiatedByUser User    @relation(fields: [initiatedByUserId], references: [id])

  @@map("refunds")
}
```

`User` ganha a relação inversa `refundsInitiated Refund[]`.

### `PaymentProvider` (interface + 3 implementações)

Novo método, sem campo de valor (só estorno total, decisão já tomada):

```ts
refundPayment(input: { providerPaymentId: string }): Promise<{ providerRefundId?: string }>
```

- `MercadoPagoProvider`: usa `PaymentRefund.create({ payment_id: input.providerPaymentId })` do SDK já instalado.
- `PagarMeProvider`: `DELETE /charges/{providerPaymentId}` (o helper `request()` interno precisa aceitar um método HTTP configurável — hoje só faz `POST`; ajuste retrocompatível, mantendo `POST` como padrão para as chamadas existentes).
- `SandboxPaymentProvider`: retorna sucesso imediato com um `providerRefundId` sintético, sem chamada de rede.

Em todos os casos, erro do gateway lança exceção — quem chama não grava nada no banco se isso acontecer.

### Serviço central: `lib/payment/refund-service.ts`

```ts
refundPayment(params: { paymentId: string; initiatedByUserId: string; reason?: string }): Promise<void>
```

Passos:
1. Carrega `Payment` + `Order` + `Registration[]` do pedido. Erro se não achar, ou se `Payment.status !== "PAID"`.
2. Chama `provider.refundPayment({ providerPaymentId })`. Se lançar erro, propaga (nada é gravado).
3. Em uma transação: cria o `Refund` (valor = `Payment.amount`, `processedAt = now()`, `providerRefundId`, `initiatedByUserId`, `reason`); atualiza `Payment.status = REFUNDED` + `refundedAt`; atualiza `Order.status = REFUNDED`; para cada `Registration` do pedido que ainda estiver `CONFIRMED`, muda para `CANCELLED` e decrementa `TicketBatch.soldCount` (mesma lógica já usada em `app/api/registrations/[id]/cancel/route.ts` — registrações já `CANCELLED` não são tocadas, evitando decrementar `soldCount` duas vezes); grava `AuditLog` (`action: "PAYMENT_REFUNDED"`, novo valor em `ACTION_LABEL`).

Esse serviço cobre os dois casos de uso: estornar uma inscrição ainda confirmada (organizador decide estornar proativamente) e estornar um pagamento cujo pedido já foi cancelado antes (a fila de "Pagamentos cancelados" do relatório) — no segundo caso a inscrição já está `CANCELLED`, então o passo de cancelamento é pulado.

### Rotas

- `POST /api/admin/payments/[id]/refund` — `requireAdmin()`. Corpo: `{ reason?: string }`. `[id]` é o `Payment.id`.
- `POST /api/organizer/registrations/[id]/refund` — `requireOrganizer()`. `[id]` é o `Registration.id`. Verifica que `registration.event.organizerId` pertence ao organizador autenticado (mesma fronteira de segurança do sub-projeto 3) antes de resolver o pagamento mais recente do pedido e chamar o serviço.

### UI

- `components/admin/RefundPaymentButton.tsx` — client component (padrão de `DeleteEventButton`: `confirm()` + `fetch` + `router.refresh()`), com um `prompt()` adicional para o motivo opcional. Aparece na seção "estornos" de `/admin/pagamentos/[id]` só quando `payment.status === "PAID"`.
- `components/organizer/RefundRegistrationButton.tsx` — mesmo padrão, na nova coluna "Ações" da tabela de inscritos. Visível quando o pagamento mais recente da inscrição tem `status === "PAID"` (cobre tanto inscrição ainda confirmada quanto já cancelada-mas-não-estornada).

## Fora de escopo

- Nenhum gatilho automático de estorno ao cancelar (fica para o sub-projeto 5).
- Estorno parcial (valor customizado).
- Estorno de pagamento via boleto no Pagar.me (a API exige dados bancários do comprador que não são coletados no checkout atual — se tentado, a chamada falha com erro claro em vez de tentar um caminho incompleto).
- Qualquer mudança em `app/api/registrations/[id]/cancel/route.ts` ou em qualquer outra rota de checkout/pagamento existente.

## Testes

- Testes unitários para `refundPayment` de cada provider (mockando `fetch`/SDK), cobrindo sucesso e erro do gateway.
- Testes unitários para `lib/payment/refund-service.ts` (mockando `db` e `getPaymentProvider`), cobrindo: pagamento não encontrado, pagamento não está `PAID`, erro do gateway (nada gravado), sucesso com inscrição ainda confirmada (cancela + decrementa), sucesso com inscrição já cancelada (não decrementa de novo).
- Verificação manual em `PAYMENT_PROVIDER=sandbox`: estornar pelo admin, estornar pelo organizador, conferir que os KPIs de relatório (sub-projetos 2 e 3) refletem corretamente sem nenhuma mudança de código neles.
