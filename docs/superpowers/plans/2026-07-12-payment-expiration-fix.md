# Corrigir pedidos de cartão presos em PENDING — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop credit-card payments from getting permanently stuck at `PENDING`. A card the gateway
rejects gets cancelled immediately (order cancelled, ticket released, in the same checkout
request). A card that's still processing/under review gets a fallback `expiresAt` so the existing
expire-payments safety net can eventually release it.

**Architecture:** `CreatePaymentResult.status` gains a `"CANCELLED"` value. Both gateway providers
(`MercadoPagoProvider`, `PagarMeProvider`) map their card-creation response to `PAID` / `CANCELLED`
/ `PENDING`-with-`expiresAt` instead of the current `PAID`/`PENDING`-with-no-`expiresAt`. The
checkout route handles a `CANCELLED` result by creating the `Payment` as `PENDING` and immediately
transitioning it to `CANCELLED` via the already-existing `applyGatewayStatus` helper (used today by
webhook/reconciliation) — this cancels the order, cancels the registration, releases the ticket
batch's `soldCount`, and writes the audit log, all in one call. No schema changes — `PaymentStatus.
CANCELLED` and `OrderStatus.CANCELLED` already exist.

**Tech Stack:** Next.js App Router route handlers, Prisma, Vitest. Mercado Pago Node SDK, Pagar.me
REST API (raw `fetch`).

## Global Constraints

- A card the gateway reports as rejected (`rejected` on Mercado Pago; `failed`/`canceled` on
  Pagar.me) must be cancelled synchronously, inside the checkout request — not left as `PENDING`
  waiting for a later job.
- A card left genuinely pending/in-review must get a fallback `expiresAt`: **48 hours** for
  Mercado Pago (its `pending_contingency`/`pending_review_manual` review resolves "em até 2 dias
  úteis" per official docs), **1 hour** for Pagar.me (its "Cancelamento Garantido" feature already
  promises near-real-time resolution of stuck `processing` charges, so 1h is just a safety margin).
- Reuse `applyGatewayStatus` (`lib/payment/sync-payment-status.ts`) for the cancel-order-and-
  release-inventory sequence — do not write a second, near-duplicate helper. Do not touch
  `cancelExpiredPayment` (`lib/payment/expire-payments.ts`) — it has its own separate inline
  version of this logic; refactoring it to also use `applyGatewayStatus` is out of scope for this
  bug fix.
- Do not touch `lib/payment/reconciliation.ts` or webhook handling — they're already correct for
  payments that already have a defined status; the gap was only in the initial card-creation
  response.
- Do not change PIX/boleto behavior in any provider — both already set `expiresAt` correctly.
- No new Prisma enum values or migrations — `PaymentStatus.CANCELLED` and `OrderStatus.CANCELLED`
  already exist in `prisma/schema.prisma`.

---

### Task 1: Mercado Pago card-creation status mapping

**Files:**
- Modify: `lib/payment/types.ts`
- Modify: `lib/payment/mercadopago.ts:189-193`
- Test: `tests/payment-mercadopago-create.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CreatePaymentResult.status` now includes `"CANCELLED"` — Task 2 (Pagar.me) and Task 3
  (checkout route) both rely on this type change already being in place.

- [ ] **Step 1: Add `"CANCELLED"` to `CreatePaymentResult.status`**

In `lib/payment/types.ts`, change:

```ts
export interface CreatePaymentResult {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "EXPIRED";
```

to:

```ts
export interface CreatePaymentResult {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
```

- [ ] **Step 2: Write the failing tests for the new card-status mapping**

Create `tests/payment-mercadopago-create.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({ create: createMock })),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";
import type { CreatePaymentInput } from "@/lib/payment/types";

const baseInput: CreatePaymentInput = {
  orderId: "order-1",
  amount: 10000,
  method: "CREDIT_CARD",
  idempotencyKey: "idem-1",
  buyer: { name: "Ana Silva", email: "ana@example.com" },
  description: "Inscrição #1",
  cardToken: "card-token-1",
  cardBrand: "visa",
  installments: 1,
};

describe("MercadoPagoProvider.createPayment (cartão)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia 'approved' para PAID e extrai a comissão do gateway", async () => {
    createMock.mockResolvedValueOnce({
      id: 123,
      status: "approved",
      fee_details: [{ type: "mercadopago_fee", amount: 4.99, fee_payer: "collector" }],
    });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PAID");
    expect(result.gatewayFeeAmount).toBe(499);
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'rejected' para CANCELLED, sem expiresAt", async () => {
    createMock.mockResolvedValueOnce({ id: 124, status: "rejected" });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("CANCELLED");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'in_process' para PENDING com expiresAt ~48h no futuro", async () => {
    createMock.mockResolvedValueOnce({ id: 125, status: "in_process" });
    const before = Date.now();
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
    const deltaMs = (result.expiresAt as Date).getTime() - before;
    expect(deltaMs).toBeGreaterThan(47 * 3600 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(48 * 3600 * 1000 + 5000);
  });

  it("mapeia qualquer outro status pendente (ex.: 'pending') da mesma forma", async () => {
    createMock.mockResolvedValueOnce({ id: 126, status: "pending" });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/payment-mercadopago-create.test.ts`

Expected: FAIL — the current code always returns `status: "PENDING"` for anything but `"approved"`,
never `"CANCELLED"`, and never sets `expiresAt` for cards. The "rejected" and "in_process"/"pending"
tests fail; the "approved" test should already pass (behavior unchanged for that case).

- [ ] **Step 4: Implement the new mapping**

In `lib/payment/mercadopago.ts`, replace lines 189-193 (currently):

```ts
    return {
      providerPaymentId: String(resCC.id),
      status: resCC.status === "approved" ? "PAID" : "PENDING",
      gatewayFeeAmount: resCC.status === "approved" ? extractGatewayFeeAmount(resCC) : undefined,
    };
  }
```

with:

```ts
    const CARD_CREATE_FALLBACK_EXPIRY_MS = 48 * 3600 * 1000; // 48h — pending_contingency/pending_review_manual resolvem "em até 2 dias úteis" por doc oficial da MP

    if (resCC.status === "approved") {
      return {
        providerPaymentId: String(resCC.id),
        status: "PAID",
        gatewayFeeAmount: extractGatewayFeeAmount(resCC),
      };
    }
    if (resCC.status === "rejected") {
      return { providerPaymentId: String(resCC.id), status: "CANCELLED" };
    }
    return {
      providerPaymentId: String(resCC.id),
      status: "PENDING",
      expiresAt: new Date(Date.now() + CARD_CREATE_FALLBACK_EXPIRY_MS),
    };
  }
```

(This is the closing block of the card branch inside `createPayment` — the `if (!input.cardToken)
...` guard and the rest of the branch above it are unchanged.)

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/payment-mercadopago-create.test.ts`

Expected: PASS, all 4 tests.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (existing `tests/payment-mercadopago-status.test.ts` and
`tests/payment-mercadopago-refund.test.ts` are untouched by this change and must remain green).

- [ ] **Step 7: Commit**

```bash
git add lib/payment/types.ts lib/payment/mercadopago.ts tests/payment-mercadopago-create.test.ts
git commit -m "fix: cancel rejected MP card charges immediately, expire in-review ones after 48h"
```

---

### Task 2: Pagar.me card-creation status mapping

**Files:**
- Modify: `lib/payment/pagarme.ts:135-139`
- Test: `tests/payment-pagarme-create.test.ts` (new)

**Interfaces:**
- Consumes: `CreatePaymentResult.status` including `"CANCELLED"` (Task 1, `lib/payment/types.ts`).
- Produces: nothing consumed by later tasks — Task 3 doesn't touch provider code, only the generic
  `CreatePaymentResult.status` contract both providers already share.

- [ ] **Step 1: Write the failing tests for the new card-status mapping**

Create `tests/payment-pagarme-create.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";
import type { CreatePaymentInput } from "@/lib/payment/types";

const baseInput: CreatePaymentInput = {
  orderId: "order-1",
  amount: 10000,
  method: "CREDIT_CARD",
  idempotencyKey: "idem-1",
  buyer: { name: "Ana Silva", email: "ana@example.com" },
  description: "Inscrição #1",
  cardToken: "card-token-1",
  installments: 1,
};

describe("PagarMeProvider.createPayment (cartão)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("mapeia 'paid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_1", status: "paid" }) });
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PAID");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'failed' para CANCELLED, sem expiresAt", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_2", status: "failed" }) });
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("CANCELLED");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'canceled' para CANCELLED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_3", status: "canceled" }) });
    const provider = new PagarMeProvider();
    expect((await provider.createPayment(baseInput)).status).toBe("CANCELLED");
  });

  it("mapeia 'processing' para PENDING com expiresAt ~1h no futuro", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_4", status: "processing" }) });
    const before = Date.now();
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
    const deltaMs = (result.expiresAt as Date).getTime() - before;
    expect(deltaMs).toBeGreaterThan(59 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(3600 * 1000 + 5000);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/payment-pagarme-create.test.ts`

Expected: FAIL — the current code returns `status: "PENDING"` for anything but `"paid"`, never
`"CANCELLED"`, and never sets `expiresAt`. The "paid" test should already pass unchanged.

- [ ] **Step 3: Implement the new mapping**

In `lib/payment/pagarme.ts`, replace lines 135-139 (currently):

```ts
      const chargeStatus = String(data.status ?? "");
      return {
        providerPaymentId: String(data.id),
        status: chargeStatus === "paid" ? "PAID" : "PENDING",
      };
    }
```

with:

```ts
      const CARD_CREATE_FALLBACK_EXPIRY_MS = 3600 * 1000; // 1h — Pagar.me "Cancelamento Garantido" já resolve `processing` quase em tempo real

      const chargeStatus = String(data.status ?? "");
      if (chargeStatus === "paid") {
        return { providerPaymentId: String(data.id), status: "PAID" };
      }
      if (chargeStatus === "failed" || chargeStatus === "canceled") {
        return { providerPaymentId: String(data.id), status: "CANCELLED" };
      }
      return {
        providerPaymentId: String(data.id),
        status: "PENDING",
        expiresAt: new Date(Date.now() + CARD_CREATE_FALLBACK_EXPIRY_MS),
      };
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/payment-pagarme-create.test.ts`

Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (existing `tests/payment-pagarme-status.test.ts` and
`tests/payment-pagarme-refund.test.ts` untouched, must remain green).

- [ ] **Step 6: Commit**

```bash
git add lib/payment/pagarme.ts tests/payment-pagarme-create.test.ts
git commit -m "fix: cancel rejected Pagar.me card charges immediately, expire processing ones after 1h"
```

---

### Task 3: Checkout route cancels rejected-card orders synchronously

**Files:**
- Modify: `lib/payment/sync-payment-status.ts:3,6-10`
- Modify: `app/api/checkout/route.ts` (add import; insert new branch after line 118, before the
  existing `const payment = await db.payment.create(...)` at line 137)
- Test: `tests/checkout-route.test.ts` (append)

**Interfaces:**
- Consumes: `CreatePaymentResult.status` including `"CANCELLED"` (Task 1); `applyGatewayStatus(tx:
  Prisma.TransactionClient, payment: {id, status}, order: {id, status}, registrations: {id,
  ticketBatchId, status}[], newStatus: GatewayPaymentStatus, source: SyncSource, options?):
  Promise<{changed: boolean}>` (pre-existing, from `lib/payment/sync-payment-status.ts`).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the `"checkout"` source to `SyncSource`**

In `lib/payment/sync-payment-status.ts`, change line 3:

```ts
export type SyncSource = "webhook" | "reconciliation" | "refund_check";
```

to:

```ts
export type SyncSource = "webhook" | "reconciliation" | "refund_check" | "checkout";
```

And change the `AUDIT_ACTION` map (lines 6-10):

```ts
const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
};
```

to:

```ts
const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
  checkout: "PAYMENT_CARD_REJECTED",
};
```

- [ ] **Step 2: Write the failing test for the checkout route's new branch**

Append to `tests/checkout-route.test.ts` (inside the existing `describe("checkout api", ...)`
block, using the same mocks already set up at the top of the file):

```ts
  it("cancela o pedido e libera a vaga quando o cartão é recusado na criação", async () => {
    enabledMethodsMock.mockResolvedValue(["CREDIT_CARD"]);
    vi.mocked(createCheckout).mockResolvedValueOnce({
      orderId: "order-1",
      registrationId: "reg-1",
      subtotalAmount: 10000,
      totalAmount: 10000,
      discountAmount: 0,
      platformFeeAmount: 0,
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-rejected", status: "CANCELLED" }),
    } as any);

    const paymentRow = { id: "payment-1", status: "PENDING" };
    const txMock = {
      payment: { create: vi.fn().mockResolvedValueOnce(paymentRow) },
      order: { update: vi.fn() },
      registration: { update: vi.fn() },
      ticketBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "CREDIT_CARD",
          cardToken: "tok-1",
          cardBrand: "visa",
        }),
      }) as any,
    );

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/recusado/i);

    expect(txMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "order-1", status: "PENDING", providerPaymentId: "pay-rejected" }),
      }),
    );
    expect(txMock.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    expect(txMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "PAYMENT_CARD_REJECTED" }) }),
    );
  });
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run tests/checkout-route.test.ts`

Expected: FAIL — the route currently has no branch for `status === "CANCELLED"`; it falls through
to the normal `db.payment.create` with `status: "PENDING"` (not inside a transaction), so
`dbMock.$transaction` (overridden in this test) is never called and `txMock.order.update` etc. are
never invoked. The response would also not be a 402.

- [ ] **Step 4: Implement the new branch in the checkout route**

In `app/api/checkout/route.ts`, add the import (next to the existing `getPaymentProvider` import
near the top of the file):

```ts
import { getPaymentProvider } from "@/lib/payment";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
```

Then, immediately after the `try { paymentResult = await provider.createPayment({...}); } catch
(payErr) { ... }` block (i.e. right before the current `const payment = await db.payment.create({`
line), insert:

```ts
  if (paymentResult.status === "CANCELLED") {
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: checkout.orderId,
          provider: providerKey,
          providerPaymentId: paymentResult.providerPaymentId,
          method: paymentMethod as PaymentMethod,
          status: "PENDING",
          amount: checkout.totalAmount,
          idempotencyKey,
        },
      });
      await applyGatewayStatus(
        tx,
        payment,
        { id: checkout.orderId, status: "PENDING" },
        [{ id: checkout.registrationId, ticketBatchId: checkoutData.ticketBatchId, status: "PENDING_PAYMENT" }],
        "CANCELLED",
        "checkout",
      );
    });

    return NextResponse.json(
      { error: "Pagamento recusado pela operadora do cartão. Verifique os dados ou tente outro cartão." },
      { status: 402 },
    );
  }

```

The existing code below (the normal `db.payment.create` for `PAID`/`PENDING`, and everything after
it) is unchanged.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/checkout-route.test.ts`

Expected: PASS, including the new test and all pre-existing tests in this file.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass. Also run `npx tsc --noEmit` (or the repo's standard type-check script if
different — check `package.json` `scripts`) to confirm the new `applyGatewayStatus` call site
type-checks against `SyncablePayment`/`SyncableOrder`/`SyncableRegistration`.

- [ ] **Step 7: Commit**

```bash
git add lib/payment/sync-payment-status.ts app/api/checkout/route.ts tests/checkout-route.test.ts
git commit -m "fix: cancel order and release inventory synchronously when checkout card is rejected"
```
