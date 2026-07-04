# Cancelamento Automático por Prazo de Pagamento Vencido Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cancelar automaticamente pedidos cujo pagamento (PIX/boleto) não foi concluído dentro do prazo informado pelo gateway, liberando a vaga reservada no lote — hoje isso nunca acontece, deixando vagas presas para sempre em checkouts abandonados.

**Architecture:** Uma rotina central (`cancelExpiredPayment`/`expirePendingPayments`) cancela pagamentos `PENDING` com `Payment.expiresAt` vencido, numa transação que também libera a vaga do lote (`TicketBatch.soldCount`). Três rotas disparam essa rotina (cron automático + botão manual do admin + botão manual do organizador), no mesmo padrão da conciliação de pagamentos (sub-projeto anterior). Uma correção separada no webhook de pagamento fecha duas corridas: webhook duplicado não decrementa a vaga duas vezes, e um webhook de aprovação atrasado (chegando depois que o cron já expirou o pagamento) devolve a vaga.

**Tech Stack:** Next.js App Router, Prisma, Vitest, TypeScript.

## Global Constraints

- A rotina usa **`Payment.expiresAt`** (prazo real do gateway) como fonte de verdade — nunca `Order.expiresAt` (campo órfão, fixo em 30 min, seria um bug grave para boletos de 3 dias).
- Liberação/devolução de vaga (`TicketBatch.soldCount`) é sempre guardada pelo status **anterior** do pagamento, nunca só pelo status novo — evita decremento duplo em webhook reentregue e fecha a corrida cron-vs-webhook-atrasado.
- Nenhuma das 3 rotas de disparo dispara alerta — a ação já é determinística e completa (diferente da conciliação, que sinaliza para revisão humana).
- Sem testes de UI/componente (convenção já estabelecida).
- Este é um sistema em produção — a correção no webhook (`app/api/webhooks/payment/route.ts`) deve ser puramente aditiva, sem alterar nenhuma lógica de mapeamento de status já existente.

---

## Task 1: Rotina central de expiração

**Files:**
- Create: `lib/payment/expire-payments.ts`
- Test: `tests/payment-expire.test.ts`

**Interfaces:**
- Consumes: `notifyPaymentError(paymentId: string): Promise<void>` (já existe em `lib/alerts/payment-error.ts`, sem alteração).
- Produces: `cancelExpiredPayment(paymentId: string): Promise<boolean>` (uso interno de `expirePendingPayments`, testado diretamente nesta task); `expirePendingPayments(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }>` — consumida pelas 3 rotas da Task 3.

- [ ] **Step 1: Escrever os testes de `cancelExpiredPayment` (falhando)**

Create `tests/payment-expire.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { cancelExpiredPayment, expirePendingPayments } from "@/lib/payment/expire-payments";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const dbMock = db as any;

describe("cancelExpiredPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false e não faz mais nada quando o pagamento não está mais PENDING", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 });
    const orderUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow: vi.fn() },
        order: { update: orderUpdate },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await cancelExpiredPayment("payment-1");

    expect(result).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("cancela o pedido e as inscrições PENDING_PAYMENT, libera a vaga do lote e grava auditoria", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      orderId: "order-1",
      order: {
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
      },
    });
    const orderUpdate = vi.fn();
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    const auditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow },
        order: { update: orderUpdate },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: auditLogCreate },
      }),
    );

    const result = await cancelExpiredPayment("payment-1");

    expect(result).toBe(true);
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    expect(registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(ticketBatchUpdate).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: "PAYMENT_AUTO_EXPIRED", entityType: "Payment", entityId: "payment-1", metadata: { orderId: "order-1" } },
    });
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não mexe em inscrições que não estão mais PENDING_PAYMENT", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      orderId: "order-1",
      order: {
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "CANCELLED" }],
      },
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow },
        order: { update: vi.fn() },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await cancelExpiredPayment("payment-1");

    expect(registrationUpdate).not.toHaveBeenCalled();
    expect(ticketBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("expirePendingPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca pagamentos PENDING com prazo vencido", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", expiresAt: { not: null, lt: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("conta quantos pagamentos foram realmente expirados", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([{ id: "payment-1" }, { id: "payment-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ orderId: "order-1", order: { registrations: [] } }),
          },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      )
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: { updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }), findUniqueOrThrow: vi.fn() },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expirePendingPayments();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });

  it("continua processando os demais quando um pagamento falha", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([{ id: "payment-1" }, { id: "payment-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      })
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ orderId: "order-2", order: { registrations: [] } }),
          },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expirePendingPayments();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/payment-expire.test.ts`
Expected: FAIL — `Cannot find module '@/lib/payment/expire-payments'`.

- [ ] **Step 3: Implementar a rotina**

Create `lib/payment/expire-payments.ts`:
```ts
import { db } from "@/lib/db";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function cancelExpiredPayment(paymentId: string): Promise<boolean> {
  const cancelled = await db.$transaction(async (tx) => {
    const result = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (result.count === 0) return false;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        orderId: true,
        order: { select: { registrations: { select: { id: true, ticketBatchId: true, status: true } } } },
      },
    });

    await tx.order.update({ where: { id: payment.orderId }, data: { status: "CANCELLED" } });

    for (const r of payment.order.registrations) {
      if (r.status !== "PENDING_PAYMENT") continue;
      await tx.registration.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }

    await tx.auditLog.create({
      data: {
        action: "PAYMENT_AUTO_EXPIRED",
        entityType: "Payment",
        entityId: paymentId,
        metadata: { orderId: payment.orderId },
      },
    });

    return true;
  });

  if (cancelled) {
    void notifyPaymentError(paymentId);
  }

  return cancelled;
}

export async function expirePendingPayments(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      expiresAt: { not: null, lt: new Date() },
      ...(options?.organizerUserId
        ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
        : {}),
    },
    select: { id: true },
  });

  let expired = 0;

  for (const payment of payments) {
    try {
      if (await cancelExpiredPayment(payment.id)) expired++;
    } catch (err) {
      console.error("[expirePendingPayments] failed to expire payment", payment.id, err);
    }
  }

  return { checked: payments.length, expired };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/payment-expire.test.ts`
Expected: PASS — 9/9 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/payment/expire-payments.ts tests/payment-expire.test.ts
git commit -m "feat: rotina de cancelamento automatico por prazo de pagamento vencido"
```

---

## Task 2: Correção no webhook (liberar/devolver vaga do lote)

**Files:**
- Modify: `app/api/webhooks/payment/route.ts`
- Test: `tests/webhook-payment-alerts.test.ts` (adiciona um novo `describe`, não altera os testes existentes)

**Interfaces:**
- Nenhuma nova função pública — mudança interna e aditiva na rota já existente.

- [ ] **Step 1: Escrever os testes (falhando)**

Find (no final de `tests/webhook-payment-alerts.test.ts`, depois do fechamento do `describe` já existente):
```ts
  it("não avisa quando o pagamento é aprovado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});
```

Replace it with:
```ts
  it("não avisa quando o pagamento é aprovado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});

describe("payment webhook capacity release", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("libera a vaga do lote quando o pagamento estava PENDING e agora expira", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "EXPIRED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: {
        status: "PENDING",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { soldCount: { decrement: 1 } },
    });
  });

  it("não libera a vaga de novo quando o pagamento já não estava mais PENDING (webhook reentregue)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "EXPIRED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "EXPIRED",
      orderId: "order-1",
      order: {
        status: "CANCELLED",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("devolve a vaga quando um webhook de aprovação atrasado chega depois do pagamento já ter expirado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "EXPIRED",
      orderId: "order-1",
      order: {
        status: "CANCELLED",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { soldCount: { increment: 1 } },
    });
  });

  it("não mexe na vaga quando o pagamento é aprovado normalmente a partir de PENDING", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: {
        status: "PENDING",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que os 4 novos falham**

Run: `npx vitest run tests/webhook-payment-alerts.test.ts`
Expected: os 2 testes originais continuam passando; os 4 novos (`payment webhook capacity release`) FALHAM, pois `dbMock.ticketBatch.update` nunca é chamado hoje.

- [ ] **Step 3: Implementar a correção no webhook**

Find (em `app/api/webhooks/payment/route.ts`):
```ts
  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: newPaymentStatus,
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        rawPayload: event.rawPayload as Parameters<typeof db.payment.update>[0]["data"]["rawPayload"],
      },
    }),
    db.order.update({
      where: { id: payment.orderId },
      data: { status: newOrderStatus },
    }),
    ...(newRegistrationStatus
      ? payment.order.registrations.map((r) =>
          db.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } })
        )
      : []),
    db.auditLog.create({
      data: {
        action: "PAYMENT_WEBHOOK",
        entityType: "Payment",
        entityId: payment.id,
        metadata: JSON.parse(JSON.stringify(event)),
      },
    }),
  ]);
```

Replace it with:
```ts
  // Libera a vaga do lote quando o pagamento expira/cancela e estava PENDING antes deste webhook —
  // corrige um bug em que a vaga reservada no checkout nunca era devolvida se o pagamento nunca fosse
  // concluído. A guarda pelo status ANTERIOR evita decrementar duas vezes se o gateway reentregar o webhook.
  const shouldReleaseCapacity =
    (newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED") && payment.status === "PENDING";

  // Devolve a vaga se um webhook de aprovação atrasado chegar depois que o cron de expiração automática
  // já tinha liberado a vaga — fecha a corrida cron-vs-webhook-atrasado.
  const shouldRestoreCapacity =
    newPaymentStatus === "PAID" && (payment.status === "EXPIRED" || payment.status === "CANCELLED");

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: newPaymentStatus,
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        rawPayload: event.rawPayload as Parameters<typeof db.payment.update>[0]["data"]["rawPayload"],
      },
    }),
    db.order.update({
      where: { id: payment.orderId },
      data: { status: newOrderStatus },
    }),
    ...(newRegistrationStatus
      ? payment.order.registrations.map((r) =>
          db.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } })
        )
      : []),
    ...(shouldReleaseCapacity
      ? payment.order.registrations.map((r) =>
          db.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } })
        )
      : []),
    ...(shouldRestoreCapacity
      ? payment.order.registrations.map((r) =>
          db.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { increment: 1 } } })
        )
      : []),
    db.auditLog.create({
      data: {
        action: "PAYMENT_WEBHOOK",
        entityType: "Payment",
        entityId: payment.id,
        metadata: JSON.parse(JSON.stringify(event)),
      },
    }),
  ]);
```

- [ ] **Step 4: Rodar os testes e confirmar que todos passam**

Run: `npx vitest run tests/webhook-payment-alerts.test.ts`
Expected: PASS — 6/6 testes (2 originais + 4 novos).

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/payment/route.ts tests/webhook-payment-alerts.test.ts
git commit -m "fix: libera e devolve vaga do lote no webhook de pagamento"
```

---

## Task 3: Rotas de disparo (cron, admin, organizador)

**Files:**
- Create: `app/api/cron/expire-payments/route.ts`
- Create: `app/api/admin/expire-payments/route.ts`
- Create: `app/api/organizer/expire-payments/route.ts`
- Test: `tests/cron-expire-payments-route.test.ts`
- Test: `tests/admin-expire-payments-route.test.ts`
- Test: `tests/organizer-expire-payments-route.test.ts`

**Interfaces:**
- Consumes: `expirePendingPayments` (Task 1).
- Produces: `POST /api/cron/expire-payments`, `POST /api/admin/expire-payments`, `POST /api/organizer/expire-payments` — todas retornam `{ checked: number; expired: number }` — consumidas pela Task 4 (UI).

- [ ] **Step 1: Escrever os testes do cron (falhando)**

Create `tests/cron-expire-payments-route.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/expire-payments", () => ({ expirePendingPayments: vi.fn() }));

import { POST } from "@/app/api/cron/expire-payments/route";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

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
  });

  it("roda a expiração sem filtro e retorna o resultado", async () => {
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 2, expired: 1 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha, depois implementar a rota de cron**

Run: `npx vitest run tests/cron-expire-payments-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/expire-payments/route'`.

Create `app/api/cron/expire-payments/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await expirePendingPayments();
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Rodar os testes do cron e confirmar que passam**

Run: `npx vitest run tests/cron-expire-payments-route.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 4: Escrever os testes do admin (falhando)**

Create `tests/admin-expire-payments-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({ expirePendingPayments: vi.fn() }));

import { POST } from "@/app/api/admin/expire-payments/route";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

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
  });

  it("roda a expiração sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 5, expired: 3 });

    const res = await POST();
    const body = await res.json();

    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, expired: 3 });
  });
});
```

- [ ] **Step 5: Rodar e confirmar que falha, depois implementar a rota do admin**

Run: `npx vitest run tests/admin-expire-payments-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/expire-payments/route'`.

Create `app/api/admin/expire-payments/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await expirePendingPayments();
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Rodar os testes do admin e confirmar que passam**

Run: `npx vitest run tests/admin-expire-payments-route.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 7: Escrever os testes do organizador (falhando)**

Create `tests/organizer-expire-payments-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({ expirePendingPayments: vi.fn() }));

import { POST } from "@/app/api/organizer/expire-payments/route";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

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
  });

  it("roda a expiração escopada ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });

    await POST();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
  });
});
```

- [ ] **Step 8: Rodar e confirmar que falha, depois implementar a rota do organizador**

Run: `npx vitest run tests/organizer-expire-payments-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/organizer/expire-payments/route'`.

Create `app/api/organizer/expire-payments/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await expirePendingPayments({ organizerUserId: session.user.id });
  return NextResponse.json(result);
}
```

- [ ] **Step 9: Rodar os testes do organizador e confirmar que passam**

Run: `npx vitest run tests/organizer-expire-payments-route.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 10: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 11: Commit**

```bash
git add app/api/cron/expire-payments app/api/admin/expire-payments app/api/organizer/expire-payments tests/cron-expire-payments-route.test.ts tests/admin-expire-payments-route.test.ts tests/organizer-expire-payments-route.test.ts
git commit -m "feat: rotas de disparo do cancelamento automatico por prazo vencido"
```

---

## Task 4: UI — páginas, painel e links de menu

**Files:**
- Create: `components/payment/ExpirePaymentsPanel.tsx`
- Create: `app/admin/pedidos-vencidos/page.tsx`
- Create: `app/organizador/pedidos-vencidos/page.tsx`
- Modify: `lib/admin/labels.ts`
- Modify: `components/admin/AdminNav.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/expire-payments`, `POST /api/organizer/expire-payments` (Task 3).

Sem testes automatizados de UI (convenção já estabelecida); verificação manual na Task 5.

- [ ] **Step 1: Adicionar o rótulo de auditoria**

Find (em `lib/admin/labels.ts`):
```ts
  CART_ABANDONED: "Carrinho abandonado",
  REGISTRATION_MANUALLY_CONFIRMED: "Inscrição confirmada manualmente",
};
```

Replace it with:
```ts
  CART_ABANDONED: "Carrinho abandonado",
  REGISTRATION_MANUALLY_CONFIRMED: "Inscrição confirmada manualmente",
  PAYMENT_AUTO_EXPIRED: "Pagamento expirado automaticamente",
};
```

- [ ] **Step 2: Criar o painel reutilizável**

Create `components/payment/ExpirePaymentsPanel.tsx`:
```tsx
"use client";

import { useState } from "react";

export default function ExpirePaymentsPanel({ endpoint }: { endpoint: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ checked: number; expired: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card space-y-4">
      <button type="button" onClick={handleRun} disabled={running} className="btn-primary px-6 disabled:opacity-50">
        {running ? "Processando..." : "Processar agora"}
      </button>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {result.checked} pagamento(s) verificado(s), {result.expired} cancelado(s) por prazo vencido.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Criar a página do admin**

Create `app/admin/pedidos-vencidos/page.tsx`:
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import ExpirePaymentsPanel from "@/components/payment/ExpirePaymentsPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pedidos vencidos — Admin" };

export default async function AdminPedidosVencidosPage() {
  await requireAdmin();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Pedidos com pagamento vencido</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cancela pedidos da plataforma toda cujo prazo de pagamento (PIX/boleto) já expirou sem confirmação,
          liberando a vaga do lote. Roda automaticamente por cron; use o botão para processar agora.
        </p>
      </div>

      <ExpirePaymentsPanel endpoint="/api/admin/expire-payments" />
    </div>
  );
}
```

- [ ] **Step 4: Criar a página do organizador**

Create `app/organizador/pedidos-vencidos/page.tsx`:
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import ExpirePaymentsPanel from "@/components/payment/ExpirePaymentsPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pedidos vencidos" };

export default async function OrganizerPedidosVencidosPage() {
  await requireOrganizer();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Pedidos com pagamento vencido</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cancela pedidos dos seus eventos cujo prazo de pagamento (PIX/boleto) já expirou sem confirmação,
          liberando a vaga do lote. Roda automaticamente por cron; use o botão para processar agora.
        </p>
      </div>

      <ExpirePaymentsPanel endpoint="/api/organizer/expire-payments" />
    </div>
  );
}
```

- [ ] **Step 5: Adicionar o link no menu do admin**

Find (em `components/admin/AdminNav.tsx`):
```tsx
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
        </div>
```

Replace it with:
```tsx
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/pedidos-vencidos" className="hover:text-gray-300">Pedidos vencidos</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
        </div>
```

- [ ] **Step 6: Adicionar o link no menu do organizador (bloco de tela larga)**

Find (em `components/organizer/OrganizerNav.tsx`):
```tsx
            <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
```

Replace it with:
```tsx
            <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
            <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
```

- [ ] **Step 7: Adicionar o link no menu do organizador (bloco de tela estreita)**

Find (em `components/organizer/OrganizerNav.tsx`):
```tsx
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
        </div>
      </div>
    </nav>
  );
}
```

Replace it with:
```tsx
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 8: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: tudo passa.

- [ ] **Step 10: Commit**

```bash
git add components/payment/ExpirePaymentsPanel.tsx app/admin/pedidos-vencidos app/organizador/pedidos-vencidos lib/admin/labels.ts components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx
git commit -m "feat: paginas de pedidos vencidos e links de menu"
```

---

## Task 5: Verificação manual

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Mesmo padrão de VPS descartável usado nos sub-projetos anteriores. Sem mudança de schema nesta feature — só `git pull` e reiniciar o servidor.

- [ ] **Step 2: Expiração básica**

Via SQL ou script Node ad-hoc, criar um `Payment` com `status="PENDING"`, `expiresAt` no passado, ligado a uma `Registration` `PENDING_PAYMENT` num `TicketBatch` com `soldCount` conhecido (ex.: 5). Chamar `POST /api/admin/expire-payments` autenticado como admin. Confirmar no banco: `Payment.status = "EXPIRED"`, `Order.status = "CANCELLED"`, `Registration.status = "CANCELLED"`, `TicketBatch.soldCount = 4`, e uma linha em `AuditLog` com `action = "PAYMENT_AUTO_EXPIRED"`.

- [ ] **Step 3: Idempotência**

Chamar `POST /api/admin/expire-payments` de novo imediatamente. Confirmar que `soldCount` continua em 4 (não decrementa de novo) e que a resposta não conta mais esse pagamento em `checked` (já não está mais `PENDING`).

- [ ] **Step 4: Correção do webhook — liberação**

Criar outro `Payment` `PENDING` com `providerPaymentId` preenchido, ligado a outra `Registration`/`TicketBatch` (com `soldCount` conhecido). Simular uma chamada ao webhook (`POST /api/webhooks/payment`) com um payload que o provedor sandbox mapeia para `"cancelled"`/`"expired"`. Confirmar que `soldCount` desse lote decrementou em 1. Reenviar o MESMO payload de webhook (simulando reentrega do gateway) e confirmar que `soldCount` NÃO decrementa de novo.

- [ ] **Step 5: Correção do webhook — devolução**

Usando o `Payment` já expirado da Step 2 (ou um novo, expirado via `expirePendingPayments`), simular um webhook de aprovação (`"approved"`/`"paid"`) para esse MESMO `providerPaymentId`. Confirmar que `Payment.status` volta para `PAID`, `Order.status` volta para `PAID`, `Registration.status` volta para `CONFIRMED`, e que `TicketBatch.soldCount` foi incrementado de volta (devolvendo a vaga liberada indevidamente).

- [ ] **Step 6: Autorização das rotas**

Confirmar que `POST /api/cron/expire-payments` sem o segredo correto retorna 401; que `POST /api/admin/expire-payments` como atleta/organizador retorna 403; que `POST /api/organizer/expire-payments` como atleta retorna 403 e roda escopado corretamente como organizador.

- [ ] **Step 7: Relatar ao usuário**

Resumir o que foi verificado e aguardar autorização explícita antes de qualquer push/deploy em produção — esta mudança altera uma rota de webhook de pagamento já em produção (ainda que de forma aditiva) e introduz uma nova capacidade de cancelamento automático de pedidos.
