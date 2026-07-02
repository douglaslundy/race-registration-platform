# Estorno de pagamento (Mercado Pago + Pagar.me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin or the owning organizer trigger a full refund on a paid payment — calling the real gateway API (Mercado Pago or Pagar.me) or a sandbox simulation — with the refund only recorded in the database after the gateway confirms success.

**Architecture:** Add a `refundPayment` method to the existing `PaymentProvider` interface (implemented by all three providers), a single `lib/payment/refund-service.ts` that orchestrates gateway call → transactional DB writes, and two thin API routes (admin, organizer) that call it with different authorization checks. Two new UI buttons trigger the routes.

**Tech Stack:** Next.js App Router (route handlers + client components), Prisma, the `mercadopago` npm SDK (already installed), Vitest.

## Global Constraints

- **Strict order of operations:** the gateway API call happens first; the database is only written to if that call succeeds. If it throws, nothing in the database changes — the caller sees the error and can retry.
- Only **full** refunds — no partial-amount field anywhere in this plan.
- Refunds are only ever triggered by an explicit authenticated action (admin or the event's organizer clicking a button with a confirmation dialog) — never automatically, and never from any existing route.
- Do not modify `app/api/registrations/[id]/cancel/route.ts` or any other existing payment/checkout/cancellation route.
- API routes that check authorization must use `auth()` + a manual role check (matching `app/api/admin/report/export/route.ts`), **not** `requireAdmin()`/`requireOrganizer()` — those call `redirect()`, which is for page Server Components, not JSON API routes.
- Follow the existing pure-service + unit-test pattern already used across this codebase (`lib/admin/report.ts`, `lib/organizer/report.ts`, etc.).
- Commit at the end of every completed task. Never `git push` or deploy without explicit user authorization.
- Run `npx tsc --noEmit` and `npm test` before each commit that touches `.tsx`/`.ts` files.

---

### Task 1: Schema — track who initiated a refund and the gateway's refund ID

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit the `Refund` model**

In `prisma/schema.prisma`, find:

```prisma
model Refund {
  id            String   @id @default(cuid())
  paymentId     String
  amount        Int      // centavos
  reason        String?
  processedAt   DateTime?
  createdAt     DateTime @default(now())

  payment Payment @relation(fields: [paymentId], references: [id])

  @@map("refunds")
}
```

Replace it with:

```prisma
model Refund {
  id                String    @id @default(cuid())
  paymentId         String
  amount            Int       // centavos
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

- [ ] **Step 2: Add the back-relation on `User`**

Find, inside `model User { ... }`:

```prisma
  createdCoupons   Coupon[]          @relation("CouponCreator")

  @@map("users")
```

Replace it with:

```prisma
  createdCoupons   Coupon[]          @relation("CouponCreator")
  refundsInitiated Refund[]

  @@map("users")
```

- [ ] **Step 3: Regenerate the Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` with no errors. This only reads `schema.prisma` — it does not need a database connection.

Note: this repo's `prisma/migrations/` folder is not in sync with `schema.prisma` (some existing model fields have no corresponding migration file — schema changes here have historically been applied with `npx prisma db push` against a reachable database, not `prisma migrate`). Do not create a migration folder for this change. The actual database schema sync happens later, during manual verification (Task 6), via `npx prisma db push` against a real database — exactly like every prior sub-project in this series.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (nothing references the new fields yet, so this is purely additive).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Feat: schema de estorno registra quem iniciou e o ID do estorno no gateway"
```

---

### Task 2: `refundPayment` on all three payment providers

**Files:**
- Modify: `lib/payment/types.ts`
- Modify: `lib/payment/mercadopago.ts`
- Modify: `lib/payment/pagarme.ts`
- Modify: `lib/payment/sandbox.ts`
- Test: `tests/payment-mercadopago-refund.test.ts`
- Test: `tests/payment-pagarme-refund.test.ts`
- Test: `tests/payment-sandbox-refund.test.ts`

**Interfaces:**
- Produces: `RefundPaymentInput { providerPaymentId: string }`, `RefundPaymentResult { providerRefundId?: string }`, and `PaymentProvider.refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>` — consumed by Task 3.

All three providers must be updated together in this one task: `PaymentProvider` is a TypeScript interface, and a class that `implements` it fails to compile the moment the interface gains a new required method. Splitting this across tasks would leave an intermediate commit that doesn't build.

- [ ] **Step 1: Add the new types and interface method**

In `lib/payment/types.ts`, find:

```ts
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
}
```

Replace it with:

```ts
export interface RefundPaymentInput {
  providerPaymentId: string;
}

export interface RefundPaymentResult {
  providerRefundId?: string;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
}
```

- [ ] **Step 2: Write the failing test for `MercadoPagoProvider.refundPayment`**

Create `tests/payment-mercadopago-refund.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn(),
  PaymentRefund: vi.fn().mockImplementation(() => ({ create: createMock })),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

describe("MercadoPagoProvider.refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls PaymentRefund.create with the provider payment id and returns the refund id", async () => {
    createMock.mockResolvedValueOnce({ id: 999 });
    const provider = new MercadoPagoProvider();
    const result = await provider.refundPayment({ providerPaymentId: "123456" });
    expect(createMock).toHaveBeenCalledWith({ payment_id: "123456" });
    expect(result).toEqual({ providerRefundId: "999" });
  });

  it("propagates an error when the gateway call fails", async () => {
    createMock.mockRejectedValueOnce(new Error("MP down"));
    const provider = new MercadoPagoProvider();
    await expect(provider.refundPayment({ providerPaymentId: "123456" })).rejects.toThrow("MP down");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/payment-mercadopago-refund.test.ts`
Expected: FAIL — `provider.refundPayment is not a function`.

- [ ] **Step 4: Implement `refundPayment` in `MercadoPagoProvider`**

In `lib/payment/mercadopago.ts`, find the top import:

```ts
import { MercadoPagoConfig, Payment } from "mercadopago";
```

Replace it with:

```ts
import { MercadoPagoConfig, Payment, PaymentRefund } from "mercadopago";
```

Find:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
} from "./types";
```

Replace it with:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Find:

```ts
    return {
      providerPaymentId: String(resCC.id),
      status: resCC.status === "approved" ? "PAID" : "PENDING",
    };
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
```

Replace it with:

```ts
    return {
      providerPaymentId: String(resCC.id),
      status: resCC.status === "approved" ? "PAID" : "PENDING",
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const client = await getClient();
    const refundApi = new PaymentRefund(client);
    console.log("[mp] refundPayment providerPaymentId=%s", input.providerPaymentId);
    const res = await refundApi.create({ payment_id: input.providerPaymentId });
    return { providerRefundId: res.id !== undefined ? String(res.id) : undefined };
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/payment-mercadopago-refund.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing test for `PagarMeProvider.refundPayment`**

Create `tests/payment-pagarme-refund.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";

describe("PagarMeProvider.refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("sends a DELETE request to /charges/{id} and returns the refund id", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "ch_refund_1" }),
    });

    const provider = new PagarMeProvider();
    const result = await provider.refundPayment({ providerPaymentId: "ch_123" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pagar.me/core/v5/charges/ch_123",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ providerRefundId: "ch_refund_1" });
  });

  it("throws when the gateway returns an error status", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "charge already refunded",
    });

    const provider = new PagarMeProvider();
    await expect(provider.refundPayment({ providerPaymentId: "ch_123" })).rejects.toThrow("Pagar.me 422");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- tests/payment-pagarme-refund.test.ts`
Expected: FAIL — `provider.refundPayment is not a function`.

- [ ] **Step 8: Implement `refundPayment` in `PagarMeProvider`**

In `lib/payment/pagarme.ts`, find:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
} from "./types";
```

Replace it with:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Find:

```ts
async function request(path: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: await authHeader(),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pagar.me ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}
```

Replace it with:

```ts
async function request(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
  method: "POST" | "DELETE" = "POST",
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: await authHeader(),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pagar.me ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}
```

Find:

```ts
    throw new Error(`Método ${input.method} não suportado pelo Pagar.me`);
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
```

Replace it with:

```ts
    throw new Error(`Método ${input.method} não suportado pelo Pagar.me`);
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const data = await request(`/charges/${input.providerPaymentId}`, {}, undefined, "DELETE");
    return { providerRefundId: data.id !== undefined ? String(data.id) : undefined };
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- tests/payment-pagarme-refund.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Write the failing test for `SandboxPaymentProvider.refundPayment`**

Create `tests/payment-sandbox-refund.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

describe("SandboxPaymentProvider.refundPayment", () => {
  it("returns a synthetic refund id without any network call", async () => {
    const provider = new SandboxPaymentProvider();
    const result = await provider.refundPayment({ providerPaymentId: "sandbox_abc" });
    expect(result).toEqual({ providerRefundId: "sandbox_refund_sandbox_abc" });
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npm test -- tests/payment-sandbox-refund.test.ts`
Expected: FAIL — `provider.refundPayment is not a function`.

- [ ] **Step 12: Implement `refundPayment` in `SandboxPaymentProvider`**

In `lib/payment/sandbox.ts`, find:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
} from "./types";
```

Replace it with:

```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Find:

```ts
    return { providerPaymentId: id, status: "PAID" };
  }

  async verifyWebhookSignature(_payload: string, signature: string): Promise<boolean> {
```

Replace it with:

```ts
    return { providerPaymentId: id, status: "PAID" };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    return { providerRefundId: `sandbox_refund_${input.providerPaymentId}` };
  }

  async verifyWebhookSignature(_payload: string, signature: string): Promise<boolean> {
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `npm test -- tests/payment-sandbox-refund.test.ts`
Expected: PASS (1 test).

- [ ] **Step 14: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 15: Commit**

```bash
git add lib/payment/types.ts lib/payment/mercadopago.ts lib/payment/pagarme.ts lib/payment/sandbox.ts tests/payment-mercadopago-refund.test.ts tests/payment-pagarme-refund.test.ts tests/payment-sandbox-refund.test.ts
git commit -m "Feat: refundPayment nos três provedores de pagamento (Mercado Pago, Pagar.me, Sandbox)"
```

---

### Task 3: Refund service — gateway call, then transactional DB write

**Files:**
- Create: `lib/payment/refund-service.ts`
- Modify: `lib/admin/labels.ts`
- Test: `tests/refund-service.test.ts`

**Interfaces:**
- Consumes: `getPaymentProvider` from `@/lib/payment` (existing), `PaymentProvider.refundPayment` from Task 2.
- Produces: `refundPayment(params: { paymentId: string; initiatedByUserId: string; reason?: string }): Promise<void>` — consumed by Task 4 and Task 5.

- [ ] **Step 1: Add the audit log label**

In `lib/admin/labels.ts`, find:

```ts
  TRANSFER_CREATED: "Repasse criado",
  TRANSFER_COMPLETED: "Repasse concluído",
  TRANSFER_FAILED: "Repasse falhou",
};
```

Replace it with:

```ts
  TRANSFER_CREATED: "Repasse criado",
  TRANSFER_COMPLETED: "Repasse concluído",
  TRANSFER_FAILED: "Repasse falhou",
  PAYMENT_REFUNDED: "Pagamento estornado",
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/refund-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({
  getPaymentProvider: vi.fn(),
}));

const dbMock = db as any;
const getPaymentProviderMock = vi.mocked(getPaymentProvider);

describe("refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the payment does not exist", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce(null);
    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "Pagamento não encontrado",
    );
  });

  it("throws when the payment is not PAID", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [] },
    });
    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "Só é possível estornar pagamentos com status Pago",
    );
  });

  it("does not write anything when the gateway call fails", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [] },
    });
    const refundPaymentGateway = vi.fn().mockRejectedValueOnce(new Error("gateway down"));
    getPaymentProviderMock.mockResolvedValueOnce({ refundPayment: refundPaymentGateway } as any);

    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "gateway down",
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("cancels a still-confirmed registration and decrements soldCount on success", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [{ id: "reg-1", status: "CONFIRMED", ticketBatchId: "tb-1" }] },
    });
    const refundPaymentGateway = vi.fn().mockResolvedValueOnce({ providerRefundId: "mp-refund-1" });
    getPaymentProviderMock.mockResolvedValueOnce({ refundPayment: refundPaymentGateway } as any);

    const txRefundCreate = vi.fn();
    const txPaymentUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txRegistrationUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { create: txRefundCreate },
        payment: { update: txPaymentUpdate },
        order: { update: txOrderUpdate },
        registration: { update: txRegistrationUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1", reason: "atleta desistiu" });

    expect(refundPaymentGateway).toHaveBeenCalledWith({ providerPaymentId: "mp-1" });
    expect(txRefundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: "pay-1",
        amount: 1000,
        reason: "atleta desistiu",
        providerRefundId: "mp-refund-1",
        initiatedByUserId: "user-1",
      }),
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "REFUNDED" } });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { status: "CANCELLED" },
    });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({
      where: { id: "tb-1" },
      data: { soldCount: { decrement: 1 } },
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", action: "PAYMENT_REFUNDED", entityType: "Payment" }),
    });
  });

  it("does not touch an already-cancelled registration a second time", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [{ id: "reg-1", status: "CANCELLED", ticketBatchId: "tb-1" }] },
    });
    getPaymentProviderMock.mockResolvedValueOnce({
      refundPayment: vi.fn().mockResolvedValueOnce({ providerRefundId: "mp-refund-1" }),
    } as any);

    const txRegistrationUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { create: vi.fn() },
        payment: { update: vi.fn() },
        order: { update: vi.fn() },
        registration: { update: txRegistrationUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" });

    expect(txRegistrationUpdate).not.toHaveBeenCalled();
    expect(txTicketBatchUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/refund-service.test.ts`
Expected: FAIL with "Cannot find module '@/lib/payment/refund-service'" (or similar resolution error).

- [ ] **Step 4: Implement `lib/payment/refund-service.ts`**

```ts
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

export interface RefundPaymentParams {
  paymentId: string;
  initiatedByUserId: string;
  reason?: string;
}

export async function refundPayment(params: RefundPaymentParams): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: { include: { registrations: true } } },
  });

  if (!payment) throw new Error("Pagamento não encontrado");
  if (payment.status !== "PAID") throw new Error("Só é possível estornar pagamentos com status Pago");
  if (!payment.providerPaymentId) throw new Error("Pagamento sem referência no gateway");

  const provider = await getPaymentProvider();
  const result = await provider.refundPayment({ providerPaymentId: payment.providerPaymentId });

  await db.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: params.reason,
        processedAt: new Date(),
        providerRefundId: result.providerRefundId,
        initiatedByUserId: params.initiatedByUserId,
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "REFUNDED" },
    });

    for (const registration of payment.order.registrations) {
      if (registration.status === "CONFIRMED") {
        await tx.registration.update({
          where: { id: registration.id },
          data: { status: "CANCELLED" },
        });
        await tx.ticketBatch.update({
          where: { id: registration.ticketBatchId },
          data: { soldCount: { decrement: 1 } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: params.initiatedByUserId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { orderId: payment.orderId, amount: payment.amount, reason: params.reason ?? null },
      },
    });
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/refund-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/payment/refund-service.ts lib/admin/labels.ts tests/refund-service.test.ts
git commit -m "Feat: serviço de estorno (chama o gateway, só grava no banco se der certo)"
```

---

### Task 4: Admin-triggered refund on `/admin/pagamentos/[id]`

**Files:**
- Create: `app/api/admin/payments/[id]/refund/route.ts`
- Create: `components/admin/RefundPaymentButton.tsx`
- Modify: `app/admin/pagamentos/[id]/page.tsx`

**Interfaces:**
- Consumes: `refundPayment` from `@/lib/payment/refund-service` (Task 3).

- [ ] **Step 1: Create the admin refund route**

Create `app/api/admin/payments/[id]/refund/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refundPayment } from "@/lib/payment/refund-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao estornar pagamento";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Create the button component**

Create `components/admin/RefundPaymentButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundPaymentButton({ paymentId }: { paymentId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRefund() {
    if (
      !confirm(
        "Estornar este pagamento? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita.",
      )
    )
      return;
    const reason = prompt("Motivo do estorno (opcional):") ?? undefined;
    setLoading(true);
    const res = await fetch(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao estornar pagamento.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleRefund}
      disabled={loading}
      className="btn-secondary text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
    >
      {loading ? "Estornando..." : "Estornar pagamento"}
    </button>
  );
}
```

- [ ] **Step 3: Wire the button into the payment detail page**

In `app/admin/pagamentos/[id]/page.tsx`, find:

```tsx
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";
```

Replace it with:

```tsx
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";
import RefundPaymentButton from "@/components/admin/RefundPaymentButton";
```

Find:

```tsx
      {/* Estornos */}
      {payment.refunds.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Estornos</h2>
          {payment.refunds.map((r) => (
            <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
              <span className="text-gray-600">{r.reason ?? "—"}</span>
              <span className="font-medium text-red-600">-{formatCurrency(r.amount)}</span>
              <span className="text-gray-400 text-xs">{r.processedAt ? formatDate(r.processedAt) : "Pendente"}</span>
            </div>
          ))}
        </div>
      )}
```

Replace it with:

```tsx
      {/* Estornos */}
      {(payment.status === "PAID" || payment.refunds.length > 0) && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Estornos</h2>
            {payment.status === "PAID" && <RefundPaymentButton paymentId={payment.id} />}
          </div>
          {payment.refunds.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum estorno registrado.</p>
          ) : (
            payment.refunds.map((r) => (
              <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                <span className="text-gray-600">{r.reason ?? "—"}</span>
                <span className="font-medium text-red-600">-{formatCurrency(r.amount)}</span>
                <span className="text-gray-400 text-xs">{r.processedAt ? formatDate(r.processedAt) : "Pendente"}</span>
              </div>
            ))
          )}
        </div>
      )}
```

- [ ] **Step 4: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/payments/\[id\]/refund/route.ts components/admin/RefundPaymentButton.tsx app/admin/pagamentos/\[id\]/page.tsx
git commit -m "Feat: botão de estorno em /admin/pagamentos/[id]"
```

---

### Task 5: Organizer-triggered refund on the registrants table

**Files:**
- Create: `app/api/organizer/registrations/[id]/refund/route.ts`
- Create: `components/organizer/RefundRegistrationButton.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `refundPayment` from `@/lib/payment/refund-service` (Task 3).

- [ ] **Step 1: Create the organizer refund route**

Create `app/api/organizer/registrations/[id]/refund/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    include: {
      order: {
        include: {
          payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento pago encontrado para esta inscrição" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    await refundPayment({ paymentId: payment.id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao estornar pagamento";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Create the button component**

Create `components/organizer/RefundRegistrationButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundRegistrationButton({ registrationId }: { registrationId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRefund() {
    if (
      !confirm(
        "Estornar o pagamento desta inscrição? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita.",
      )
    )
      return;
    const reason = prompt("Motivo do estorno (opcional):") ?? undefined;
    setLoading(true);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao estornar pagamento.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleRefund}
      disabled={loading}
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      {loading ? "Estornando..." : "Estornar"}
    </button>
  );
}
```

- [ ] **Step 3: Add the "Ações" column to the registrants table**

In `app/organizador/eventos/[id]/inscritos/page.tsx`, find:

```tsx
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";
```

Replace it with:

```tsx
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
```

Find:

```tsx
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2">Status</th>
              </tr>
```

Replace it with:

```tsx
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Ações</th>
              </tr>
```

Find:

```tsx
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                        {statusInfo?.label ?? r.status}
                      </span>
                    </td>
                  </tr>
```

Replace it with:

```tsx
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                        {statusInfo?.label ?? r.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                    </td>
                  </tr>
```

- [ ] **Step 4: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/organizer/registrations/\[id\]/refund/route.ts components/organizer/RefundRegistrationButton.tsx app/organizador/eventos/\[id\]/inscritos/page.tsx
git commit -m "Feat: botão de estorno na tabela de inscritos do organizador"
```

---

### Task 6: Manual verification in the browser (sandbox only — no real gateway calls)

**Files:** none (verification only).

- [ ] **Step 1: Confirm `PAYMENT_PROVIDER` is set to `sandbox`**

Before starting the dev server, confirm the test environment's payment provider setting (database `platform_settings` row or `.env`) is `sandbox`. Do not run this verification against `mercadopago` or `pagarme` — a real refund would move real money.

- [ ] **Step 2: Start the dev server** (or reuse the disposable test environment from previous sub-projects if still available)

Run: `npm run dev`. If the database schema doesn't yet have the new `Refund` columns, run `npx prisma db push` first (needs a reachable database — see the note in Task 1).

- [ ] **Step 3: Seed a paid registration to refund**

Use a real checkout (as in earlier sub-projects' manual verification) or direct SQL to create an Order with `status = "PAID"`, a Payment with `status = "PAID"` and a `providerPaymentId` starting with `sandbox_`, and a Registration with `status = "CONFIRMED"`.

- [ ] **Step 4: Verify the admin flow**

Log in as admin, navigate to `/admin/pagamentos/[id]` for that payment. Confirm:
- "Estornar pagamento" button appears (only because `status === "PAID"`).
- Clicking it prompts for confirmation, then a reason, then shows the payment's status flip to `REFUNDED` and the new refund appears in the "Estornos" list after the page refreshes.
- Re-visiting the page shows no "Estornar pagamento" button anymore (payment is no longer `PAID`).

- [ ] **Step 5: Verify the organizer flow**

Seed a second paid+confirmed registration. Log in as the owning organizer, navigate to that event's `/organizador/eventos/[id]/inscritos`. Confirm:
- "Estornar" appears in the new "Ações" column for that row.
- Clicking it, confirming, and providing a reason refunds it; after refresh, the registration's Status badge shows "Cancelada" and the "Estornar" action is gone from that row (payment is no longer `PAID`).
- A registration belonging to a *different* organizer's event is not reachable via this organizer's `/api/organizer/registrations/[id]/refund` route (expect a 404 if attempted directly).

- [ ] **Step 6: Verify report KPIs update without any additional code changes**

Navigate to `/admin/relatorio` (sub-project 2) and `/organizador/relatorio` (sub-project 3, if the refunded registration belongs to that organizer). Confirm the refunded amount now shows under "Estornos" and no longer under "Pagamentos cancelados" or "Receita bruta" — exactly as predicted by the design doc, with zero changes to either report's code in this sub-project.

- [ ] **Step 7: Report results to the user**

Summarize what was checked and any discrepancies found, before considering this plan complete.

---
