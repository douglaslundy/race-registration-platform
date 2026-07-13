# Expirar pedidos abandonados sem pagamento associado

## Contexto

Achado em produção em 2026-07-13, ao investigar uma pergunta do usuário sobre inscrições presas
há dias aguardando pagamento: `expirePendingPayments()` (`lib/payment/expire-payments.ts`) — usada
pelo cron a cada 6h e pelos botões manuais "Processar agora" em `/admin/pedidos-vencidos` e
`/organizador/pedidos-vencidos` — só consulta a tabela `Payment`. Uma consulta direta em produção
encontrou 12 `Registration` com status `PENDING_PAYMENT` há mais de 3 dias, **todas** com `Order`
sem nenhum `Payment` associado — o atleta abandonou o checkout antes de escolher/confirmar a forma
de pagamento. `Order.expiresAt` (30 min, definido em `lib/checkout.ts:125`) já passou há dias, mas
nada no sistema hoje cancela um pedido que nunca gerou uma cobrança — é uma lacuna diferente da
corrigida na tarefa de expiração de pagamentos desta mesma sessão (aquela cobria pedidos com
`Payment` preso; esta cobre pedidos sem `Payment` nenhum). Usuário confirmou: estender o mecanismo
existente (mesmo cron, mesmo botão) em vez de só corrigir os 12 registros atuais manualmente.

## 1. `lib/payment/expire-payments.ts` — nova função `expireAbandonedOrders`

Mesmo padrão de `cancelExpiredPayment`/`expirePendingPayments` já existentes no arquivo, mas para
`Order`s sem `Payment`:

```ts
export async function cancelAbandonedOrder(orderId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (result.count === 0) return false;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { registrations: { select: { id: true, ticketBatchId: true, status: true } } },
    });

    for (const r of order.registrations) {
      if (r.status !== "PENDING_PAYMENT") continue;
      await tx.registration.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }

    await tx.auditLog.create({
      data: { action: "ORDER_ABANDONED_EXPIRED", entityType: "Order", entityId: orderId, metadata: {} },
    });

    return true;
  });
}

export async function expireAbandonedOrders(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }> {
  const orders = await db.order.findMany({
    where: {
      status: "PENDING",
      expiresAt: { not: null, lt: new Date() },
      payments: { none: {} },
      ...(options?.organizerUserId ? { event: { organizer: { userId: options.organizerUserId } } } : {}),
    },
    select: { id: true },
  });

  let expired = 0;
  for (const order of orders) {
    try {
      if (await cancelAbandonedOrder(order.id)) expired++;
    } catch (err) {
      console.error("[expireAbandonedOrders] failed to expire order", order.id, err);
    }
  }

  return { checked: orders.length, expired };
}
```

`payments: { none: {} }` is the one condition that distinguishes this from `expirePendingPayments`
— an order with even one `Payment` row (any status) is left alone here, since that's
`expirePendingPayments`'s job. No double-processing possible: a `PENDING` order either has zero
payments (this function) or at least one (the other function), never both categories.

No new `AuditLog` action string collision — `ORDER_ABANDONED_EXPIRED` is distinct from
`PAYMENT_AUTO_EXPIRED` (used by `cancelExpiredPayment`).

## 2. Wire into all 3 existing routes — no UI change needed

`app/api/cron/expire-payments/route.ts`, `app/api/admin/expire-payments/route.ts`,
`app/api/organizer/expire-payments/route.ts` each currently call only `expirePendingPayments(...)`.
Each calls `expireAbandonedOrders(...)` too (same scope arg — `{}` for cron/admin,
`{organizerUserId}` for organizer) and sums the two `{checked, expired}` results before responding:

```ts
const [payments, orders] = await Promise.all([
  expirePendingPayments(scope),
  expireAbandonedOrders(scope),
]);
const result = { checked: payments.checked + orders.checked, expired: payments.expired + orders.expired };
return NextResponse.json(result);
```

`ExpirePaymentsPanel.tsx` (the "Processar agora" button component) needs **zero changes** — it
already just displays `{result.checked} pagamento(s) verificado(s), {result.expired}
cancelado(s)`, and a combined count fits that copy without being technically inaccurate (an
abandoned order without a payment is still fairly described as a "pedido" being checked/cancelled
for a vencido prazo, matching the page's own header copy — "Cancela pedidos... cujo prazo de
pagamento já expirou").

## Testes

- `lib/payment/expire-payments.ts`: new tests for `cancelAbandonedOrder` (order not PENDING → no-op
  returns false; success → cancels order, cancels each `PENDING_PAYMENT` registration, releases
  ticket batch, writes audit log; a `CONFIRMED` registration on the same order is left alone) and
  `expireAbandonedOrders` (empty result; `organizerUserId` scoping present in the `where`; a
  `payments: { none: {} }` order is picked up, one with a payment is not — this second assertion
  is the one differentiating this function from the pre-existing `expirePendingPayments`).
- Existing `tests/payment-expire.test.ts` (covers `cancelExpiredPayment`/`expirePendingPayments`)
  is untouched — this is purely additive to the same file.
- Extend the three existing route tests (`tests/cron-expire-payments-route.test.ts`,
  `tests/admin-expire-payments-route.test.ts`, `tests/organizer-expire-payments-route.test.ts`) to
  assert the combined-sum response shape and that both underlying functions are invoked with the
  right scope.

## Fora de escopo

- Notifying the athlete that their abandoned order was cancelled — not requested; `Registration`
  cancellation already happens silently elsewhere in this app too (e.g. expired PIX/boleto).
- Reducing the 30-minute `Order.expiresAt` window itself — not requested, out of scope, that value
  is unrelated to this gap (the window already elapsed by definition for every order this touches).
- The abandoned-carts notification feature (separate, pre-existing system that emails/WhatsApps
  users about an abandoned cart) — unrelated, not modified.
- One-off manual fix for the 12 currently-stuck production rows — the deployed fix's own cron run
  (next scheduled slot, ≤6h after deploy) or the admin "Processar agora" button will pick them up
  automatically once this ships; no separate backfill script needed (unlike the card-payment
  `expiresAt` gap, these rows don't need historical data repaired — the live query just needs to
  start including them, which happens the moment this code is deployed).
