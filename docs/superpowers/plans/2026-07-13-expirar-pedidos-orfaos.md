# Expirar pedidos abandonados sem pagamento associado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing "expire vencido payments" mechanism (cron + 2 manual buttons) to also
cancel `Order`s that were abandoned before any `Payment` was ever created for them — today those
orders are invisible to the mechanism entirely, since it only queries the `Payment` table.

**Architecture:** A new function pair in the same file as the existing mechanism
(`lib/payment/expire-payments.ts`): `cancelAbandonedOrder` (mirrors `cancelExpiredPayment`'s
cancel/release/audit sequence, but starting from an `Order` with zero payments instead of a stuck
`Payment`) and `expireAbandonedOrders` (mirrors `expirePendingPayments`'s query-and-loop shape).
The three existing routes (`cron`, `admin`, `organizer`) call both functions and sum the results —
the UI component (`ExpirePaymentsPanel.tsx`) needs no changes since it only displays generic
`{checked, expired}` counts.

**Tech Stack:** Next.js API routes, Prisma, Vitest.

## Global Constraints

- `payments: { none: {} }` is the one condition separating this function's scope from the
  pre-existing `expirePendingPayments` — a `PENDING` order with even one `Payment` row (any
  status) is `expirePendingPayments`'s responsibility, never this function's. No order can match
  both, no order can match neither and get silently skipped forever.
- `ExpirePaymentsPanel.tsx` and both `/admin/pedidos-vencidos` / `/organizador/pedidos-vencidos`
  pages are NOT touched — the combined count already fits their existing generic copy.
- Audit action `ORDER_ABANDONED_EXPIRED` (distinct from `PAYMENT_AUTO_EXPIRED`).
- No migration, no new schema — `Order.status`, `Registration.status`, `TicketBatch.soldCount` all
  already exist and are already used the same way by `cancelExpiredPayment`.

---

### Task 1: `cancelAbandonedOrder` + `expireAbandonedOrders`

**Files:**
- Modify: `lib/payment/expire-payments.ts` (append two new exported functions)
- Modify: `tests/payment-expire.test.ts` (append new `describe` blocks)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `cancelAbandonedOrder(orderId: string): Promise<boolean>`,
  `expireAbandonedOrders(options?: { organizerUserId?: string }): Promise<{checked, expired}>` —
  Task 2's three routes call `expireAbandonedOrders`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payment-expire.test.ts` (after the existing `expirePendingPayments` describe
block, using the same `import` line already at the top of the file — add
`cancelAbandonedOrder, expireAbandonedOrders` to the existing
`import { cancelExpiredPayment, expirePendingPayments } from "@/lib/payment/expire-payments";`):

```ts
describe("cancelAbandonedOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false e não faz mais nada quando o pedido não está mais PENDING", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 });
    const findUniqueOrThrow = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany, findUniqueOrThrow },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await cancelAbandonedOrder("order-1");

    expect(result).toBe(false);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("cancela o pedido e as inscrições PENDING_PAYMENT, libera a vaga do lote e grava auditoria", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    const auditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany, findUniqueOrThrow },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: auditLogCreate },
      }),
    );

    const result = await cancelAbandonedOrder("order-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "order-1", status: "PENDING" }, data: { status: "CANCELLED" } });
    expect(registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(ticketBatchUpdate).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: "ORDER_ABANDONED_EXPIRED", entityType: "Order", entityId: "order-1", metadata: {} },
    });
  });

  it("não mexe em inscrições que não estão mais PENDING_PAYMENT", async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "CONFIRMED" }],
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }), findUniqueOrThrow },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await cancelAbandonedOrder("order-1");

    expect(registrationUpdate).not.toHaveBeenCalled();
    expect(ticketBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("expireAbandonedOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca pedidos PENDING sem payment com prazo vencido", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          expiresAt: { not: null, lt: expect.any(Date) },
          payments: { none: {} },
        }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders({ organizerUserId: "org-1" });

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ event: { organizer: { userId: "org-1" } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders();

    const call = dbMock.order.findMany.mock.calls[0][0];
    expect(call.where.event).toBeUndefined();
  });

  it("conta quantos pedidos foram realmente expirados", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ registrations: [] }),
          },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      )
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }), findUniqueOrThrow: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expireAbandonedOrders();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });

  it("continua processando os demais quando um pedido falha", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      })
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ registrations: [] }),
          },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expireAbandonedOrders();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/payment-expire.test.ts`

Expected: FAIL — `cancelAbandonedOrder`/`expireAbandonedOrders` don't exist yet (import error).

- [ ] **Step 3: Implement the two functions**

Append to `lib/payment/expire-payments.ts` (after the existing `expirePendingPayments` function,
end of file):

```ts
export async function cancelAbandonedOrder(orderId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
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
      ...(options?.organizerUserId
        ? { event: { organizer: { userId: options.organizerUserId } } }
        : {}),
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/payment-expire.test.ts`

Expected: PASS, all tests (existing `cancelExpiredPayment`/`expirePendingPayments` tests plus the
new ones).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/expire-payments.ts tests/payment-expire.test.ts
git commit -m "feat: expire abandoned orders that never got a payment created"
```

---

### Task 2: Wire into the 3 existing expire-payments routes

**Files:**
- Modify: `app/api/cron/expire-payments/route.ts`
- Modify: `app/api/admin/expire-payments/route.ts`
- Modify: `app/api/organizer/expire-payments/route.ts`
- Modify: `tests/cron-expire-payments-route.test.ts`
- Modify: `tests/admin-expire-payments-route.test.ts`
- Modify: `tests/organizer-expire-payments-route.test.ts`

**Interfaces:**
- Consumes: `expireAbandonedOrders` (Task 1).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing tests**

Replace `tests/cron-expire-payments-route.test.ts` in full:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/expire-payments", () => ({
  expirePendingPayments: vi.fn(),
  expireAbandonedOrders: vi.fn(),
}));

import { POST } from "@/app/api/cron/expire-payments/route";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/expire-payments", { method: "POST", headers }) as any;
}

describe("POST /api/cron/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não bate", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("roda os dois mecanismos sem filtro e soma o resultado", async () => {
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 3, expired: 2 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(expireAbandonedOrders).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, expired: 3 });
  });
});
```

Replace `tests/admin-expire-payments-route.test.ts` in full:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({
  expirePendingPayments: vi.fn(),
  expireAbandonedOrders: vi.fn(),
}));

import { POST } from "@/app/api/admin/expire-payments/route";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);

describe("POST /api/admin/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("roda os dois mecanismos sem filtro de organizador e soma o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 5, expired: 3 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 1, expired: 1 });

    const res = await POST();
    const body = await res.json();

    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(expireAbandonedOrders).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 6, expired: 4 });
  });
});
```

Replace `tests/organizer-expire-payments-route.test.ts` in full:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({
  expirePendingPayments: vi.fn(),
  expireAbandonedOrders: vi.fn(),
}));

import { POST } from "@/app/api/organizer/expire-payments/route";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);

describe("POST /api/organizer/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("roda os dois mecanismos escopados ao organizador e soma o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 1, expired: 0 });

    const res = await POST();
    const body = await res.json();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
    expect(expireAbandonedOrders).toHaveBeenCalledWith({ organizerUserId: "org-1" });
    expect(body).toEqual({ checked: 3, expired: 1 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/cron-expire-payments-route.test.ts tests/admin-expire-payments-route.test.ts tests/organizer-expire-payments-route.test.ts`

Expected: FAIL — the routes don't call `expireAbandonedOrders` yet, so the "soma o resultado"
tests get only `expirePendingPayments`'s numbers back, not the combined sum.

- [ ] **Step 3: Update the three routes**

Replace `app/api/cron/expire-payments/route.ts` in full:

```ts
import { NextRequest, NextResponse } from "next/server";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const [payments, orders] = await Promise.all([
    expirePendingPayments(),
    expireAbandonedOrders(),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
```

Replace `app/api/admin/expire-payments/route.ts` in full:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const [payments, orders] = await Promise.all([
    expirePendingPayments(),
    expireAbandonedOrders(),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
```

Replace `app/api/organizer/expire-payments/route.ts` in full:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const [payments, orders] = await Promise.all([
    expirePendingPayments({ organizerUserId: session.user.id }),
    expireAbandonedOrders({ organizerUserId: session.user.id }),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/cron-expire-payments-route.test.ts tests/admin-expire-payments-route.test.ts tests/organizer-expire-payments-route.test.ts`

Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite and type-check**

Run: `npx vitest run` and `npx tsc --noEmit`

Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/expire-payments/route.ts app/api/admin/expire-payments/route.ts app/api/organizer/expire-payments/route.ts
git add tests/cron-expire-payments-route.test.ts tests/admin-expire-payments-route.test.ts tests/organizer-expire-payments-route.test.ts
git commit -m "feat: wire abandoned-order expiration into the existing expire-payments routes"
```
