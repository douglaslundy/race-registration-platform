# Conciliação e Sincronização de Estorno Externo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o sistema detectar e sincronizar automaticamente pagamentos que foram estornados,
sofreram chargeback, ou foram aprovados fora da plataforma (direto no gateway), nos três pontos onde
isso importa: o webhook, a conciliação periódica, e o botão manual de estornar.

**Architecture:** Extrai a lógica de "o que fazer quando o status real de um pagamento muda" — hoje
inline no handler do webhook — para uma função compartilhada `applyGatewayStatus`, usada pelos três
pontos de entrada. O webhook ganha um guard corrigido (hoje descarta silenciosamente webhooks de
estorno/chargeback). A conciliação ganha duas varreduras novas (hoje só olha pagamentos `PENDING`).
O botão de estornar consulta o gateway antes de tentar estornar de novo um pagamento já estornado.

**Tech Stack:** Next.js App Router (route handlers), Prisma (Postgres), Vitest.

## Global Constraints

- `Refund` (o model) continua reservado para estornos que a **própria plataforma** processou —
  correções automáticas (webhook/conciliação/pré-checagem do botão) geram só `AuditLog`, nunca um
  registro em `Refund`, porque `Refund.initiatedByUserId` é obrigatório e essas correções não têm um
  usuário que as iniciou.
- Chargeback é tratado exatamente como estorno para efeitos locais (cancela inscrição, libera vaga).
- A conciliação sempre alerta o admin quando encontra e corrige uma divergência automaticamente —
  nunca corrige silenciosamente.
- Janelas de tempo das novas varreduras da conciliação (hardcoded, sem UI de configuração por ora):
  pagamentos `PAID` verificados dos últimos **90 dias**; pagamentos `EXPIRED`/`CANCELLED`
  verificados dos últimos **7 dias**.
- Fora de escopo: modal de confirmação amigável, varredura geral por `alert()`, botão de reenvio de
  notificação manual — todos já registrados como tarefas separadas.
- Spec completa em `docs/superpowers/specs/2026-07-04-conciliacao-estorno-externo-design.md`.

---

### Task 1: Função compartilhada `applyGatewayStatus`

**Files:**
- Create: `lib/payment/sync-payment-status.ts`
- Create: `tests/sync-payment-status.test.ts`
- Modify: `lib/admin/labels.ts` (adiciona 2 labels novas)

**Interfaces:**
- Produces: `applyGatewayStatus(tx, payment, order, registrations, newStatus, source, options?)
  => Promise<{ changed: boolean }>` — usada pelas Tasks 2, 3 e 4.
  - `tx: Prisma.TransactionClient`
  - `payment: { id: string; status: PaymentStatus }`
  - `order: { id: string; status: OrderStatus }`
  - `registrations: { id: string; ticketBatchId: string }[]`
  - `newStatus: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK"`
  - `source: "webhook" | "reconciliation" | "refund_check"`
  - `options?: { paidAt?: Date; rawPayload?: unknown }`

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `tests/sync-payment-status.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";

function makeTx() {
  return {
    payment: { update: vi.fn() },
    order: { update: vi.fn() },
    registration: { update: vi.fn() },
    ticketBatch: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

describe("applyGatewayStatus", () => {
  it("não faz nada quando o novo status é igual ao atual", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      [],
      "PAID",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está REFUNDED (terminal)", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "REFUNDED" },
      { id: "ord-1", status: "REFUNDED" },
      [],
      "CHARGEBACK",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está CHARGEBACK (terminal)", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "CHARGEBACK" },
      { id: "ord-1", status: "CANCELLED" },
      [],
      "REFUNDED",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("PENDING -> PAID confirma a inscrição sem mexer na vaga", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      registrations,
      "PAID",
      "webhook",
    );

    expect(result).toEqual({ changed: true });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "PAID" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(tx.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("PENDING -> EXPIRED cancela a inscrição e libera a vaga", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      registrations,
      "EXPIRED",
      "webhook",
    );

    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("PAID -> REFUNDED cancela a inscrição, libera a vaga e marca refundedAt", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      registrations,
      "REFUNDED",
      "reconciliation",
    );

    expect(result).toEqual({ changed: true });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED", refundedAt: expect.any(Date) }),
    });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "REFUNDED" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, action: "PAYMENT_STATUS_SYNCED_RECONCILIATION", entityType: "Payment", entityId: "pay-1" }),
    });
  });

  it("PAID -> CHARGEBACK trata igual a REFUNDED (libera vaga)", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      registrations,
      "CHARGEBACK",
      "refund_check",
    );

    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PAYMENT_STATUS_SYNCED_REFUND_CHECK" }),
    });
  });

  it("EXPIRED -> PAID (aprovação atrasada) devolve a vaga e reconfirma a inscrição", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "EXPIRED" },
      { id: "ord-1", status: "CANCELLED" },
      registrations,
      "PAID",
      "reconciliation",
    );

    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "PAID" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { increment: 1 } } });
  });

  it("guarda o rawPayload quando informado", async () => {
    const tx = makeTx();

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      [],
      "PAID",
      "webhook",
      { rawPayload: { foo: "bar" } },
    );

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ rawPayload: { foo: "bar" } }),
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/sync-payment-status.test.ts`
Expected: FAIL — módulo `@/lib/payment/sync-payment-status` não existe ainda.

- [ ] **Step 3: Criar `lib/payment/sync-payment-status.ts`**

```ts
import type { Prisma } from "@prisma/client";

export type GatewayPaymentStatus = "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
export type SyncSource = "webhook" | "reconciliation" | "refund_check";

const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
};

interface SyncablePayment {
  id: string;
  status: string;
}

interface SyncableOrder {
  id: string;
  status: string;
}

interface SyncableRegistration {
  id: string;
  ticketBatchId: string;
}

export async function applyGatewayStatus(
  tx: Prisma.TransactionClient,
  payment: SyncablePayment,
  order: SyncableOrder,
  registrations: SyncableRegistration[],
  newStatus: GatewayPaymentStatus,
  source: SyncSource,
  options?: { paidAt?: Date; rawPayload?: unknown },
): Promise<{ changed: boolean }> {
  if (newStatus === payment.status) return { changed: false };
  if (payment.status === "REFUNDED" || payment.status === "CHARGEBACK") return { changed: false };

  const newOrderStatus =
    newStatus === "PAID" ? "PAID"
    : newStatus === "REFUNDED" ? "REFUNDED"
    : newStatus === "CANCELLED" || newStatus === "EXPIRED" ? "CANCELLED"
    : order.status;

  const newRegistrationStatus =
    newStatus === "PAID"
      ? "CONFIRMED"
      : newStatus === "CANCELLED" || newStatus === "EXPIRED" || newStatus === "REFUNDED" || newStatus === "CHARGEBACK"
        ? "CANCELLED"
        : undefined;

  const shouldReleaseCapacity =
    ((newStatus === "CANCELLED" || newStatus === "EXPIRED") && payment.status === "PENDING") ||
    ((newStatus === "REFUNDED" || newStatus === "CHARGEBACK") && payment.status === "PAID");

  const shouldRestoreCapacity =
    newStatus === "PAID" && (payment.status === "EXPIRED" || payment.status === "CANCELLED");

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      ...(options?.paidAt ? { paidAt: options.paidAt } : {}),
      ...(newStatus === "REFUNDED" || newStatus === "CHARGEBACK" ? { refundedAt: new Date() } : {}),
      ...(options?.rawPayload !== undefined ? { rawPayload: options.rawPayload as Prisma.InputJsonValue } : {}),
    },
  });

  await tx.order.update({ where: { id: order.id }, data: { status: newOrderStatus } });

  if (newRegistrationStatus) {
    for (const r of registrations) {
      await tx.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } });
    }
  }

  if (shouldReleaseCapacity) {
    for (const r of registrations) {
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }
  }

  if (shouldRestoreCapacity) {
    for (const r of registrations) {
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { increment: 1 } } });
    }
  }

  await tx.auditLog.create({
    data: {
      userId: null,
      action: AUDIT_ACTION[source],
      entityType: "Payment",
      entityId: payment.id,
      metadata: { previousStatus: payment.status, newStatus },
    },
  });

  return { changed: true };
}
```

Nota: a metadata do audit log é intencionalmente mais simples que a do webhook original (que
gravava o payload inteiro do evento) — agora é `{ previousStatus, newStatus }`, consistente entre as
3 origens. O `rawPayload` continua sendo gravado na própria coluna `Payment.rawPayload` quando
informado (não duplicado no audit log).

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/sync-payment-status.test.ts`
Expected: PASS (10 testes)

- [ ] **Step 5: Adicionar os labels novos em `lib/admin/labels.ts`**

No objeto `ACTION_LABEL` (arquivo `lib/admin/labels.ts`), adicione as duas entradas novas junto das
já existentes relacionadas a pagamento:

```ts
  PAYMENT_REFUNDED: "Pagamento estornado",
  PAYMENT_STATUS_SYNCED_RECONCILIATION: "Status sincronizado pela conciliação",
  PAYMENT_STATUS_SYNCED_REFUND_CHECK: "Estorno externo detectado ao tentar estornar",
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum outro arquivo depende de `lib/admin/labels.ts` de forma
exaustiva além de `PAYMENT_STATUS_LABEL`, que não foi tocado).

- [ ] **Step 7: Commit**

```bash
git add lib/payment/sync-payment-status.ts tests/sync-payment-status.test.ts lib/admin/labels.ts
git commit -m "feat: funcao compartilhada de sincronizacao de status de pagamento"
```

---

### Task 2: Webhook processa estorno/chargeback de verdade

**Files:**
- Modify: `app/api/webhooks/payment/route.ts`
- Modify: `tests/webhook-payment-alerts.test.ts`

**Interfaces:**
- Consumes: `applyGatewayStatus(tx, payment, order, registrations, newStatus, "webhook", options)`
  da Task 1.

- [ ] **Step 1: Escrever os testes novos (falhando)**

Adicione ao final de `tests/webhook-payment-alerts.test.ts` (mesmo arquivo, novo `describe`):

```ts
describe("payment webhook refund/chargeback sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("processa um webhook de estorno mesmo com o pagamento já PAID (antes era descartado)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "REFUNDED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "PAID",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-1" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "REFUNDED" } });
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("processa chargeback também a partir de PAID", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "CHARGEBACK", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "PAID",
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

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("não reprocessa quando o pagamento já está REFUNDED (webhook duplicado ou tardio)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "REFUNDED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "REFUNDED",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "REFUNDED",
        registrations: [],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.payment.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham**

Run: `npx vitest run tests/webhook-payment-alerts.test.ts`
Expected: FAIL nos 2 primeiros testes novos (o guard atual descarta o webhook antes de chegar no
`payment.update`); o terceiro já passa (comportamento de não reprocessar já existe, ainda que por um
motivo diferente).

- [ ] **Step 3: Reescrever o trecho final de `app/api/webhooks/payment/route.ts`**

No topo do arquivo, adicione o import:

```ts
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
```

Substitua todo o trecho a partir de `if (!payment) return NextResponse.json({ ok: true });` (linha
que já existe) até o final do arquivo por:

```ts
  if (!payment) return NextResponse.json({ ok: true });

  const newPaymentStatus = event.status;

  const result = await db.$transaction(async (tx) => {
    return applyGatewayStatus(
      tx,
      payment,
      payment.order,
      payment.order.registrations,
      newPaymentStatus,
      "webhook",
      {
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        rawPayload: event.rawPayload,
      },
    );
  });

  if (!result.changed) return NextResponse.json({ ok: true });

  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(payment.orderId);
  }

  // Avisa o atleta quando o pagamento falha ou expira
  if (newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED") {
    void notifyPaymentError(payment.id);
  }

  return NextResponse.json({ ok: true });
```

Isso remove a guarda antiga (`if (payment.status === "PAID" || payment.status === "REFUNDED")
return ok`) — a decisão de "processar ou não" agora vive dentro de `applyGatewayStatus` (Task 1),
que já cobre corretamente webhook duplicado e estados terminais.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/webhook-payment-alerts.test.ts`
Expected: PASS (todos os testes, os 6 originais + os 3 novos)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/payment/route.ts tests/webhook-payment-alerts.test.ts
git commit -m "fix: webhook processa estorno e chargeback vindos do gateway"
```

---

### Task 3: Conciliação ganha duas varreduras novas

**Files:**
- Modify: `lib/payment/reconciliation.ts`
- Modify: `tests/payment-reconciliation.test.ts`
- Modify: `lib/alerts/reconciliation.ts`
- Modify: `lib/email.ts`
- Modify: `components/payment/ReconciliationPanel.tsx`

**Interfaces:**
- Consumes: `applyGatewayStatus(tx, payment, order, registrations, newStatus, "reconciliation")` da
  Task 1.
- Produces: `PaymentMismatch` ganha o campo `corrected: boolean`. `reconcilePayments()` continua
  retornando `{ checked: number; mismatches: PaymentMismatch[] }`, agora somando as 3 varreduras.

- [ ] **Step 1: Atualizar os testes existentes e escrever os novos (falhando)**

Substitua o conteúdo de `tests/payment-reconciliation.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getReconciliationAlertSettings: vi.fn() }));

import { reconcilePayments } from "@/lib/payment/reconciliation";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const pendingFixture = {
  id: "payment-1",
  providerPaymentId: "mp-1",
  status: "PENDING",
  order: { id: "order-1", event: { title: "Corrida Teste" } },
};

const paidFixture = {
  id: "payment-2",
  providerPaymentId: "mp-2",
  status: "PAID",
  orderId: "order-2",
  order: {
    id: "order-2",
    status: "PAID",
    event: { title: "Corrida Paga" },
    registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
  },
};

const expiredFixture = {
  id: "payment-3",
  providerPaymentId: "mp-3",
  status: "EXPIRED",
  orderId: "order-3",
  order: {
    id: "order-3",
    status: "CANCELLED",
    event: { title: "Corrida Expirada" },
    registrations: [{ id: "reg-2", ticketBatchId: "batch-2" }],
  },
};

describe("reconcilePayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(dbMock));
  });

  it("consulta pagamentos PENDING mais antigos que o limiar", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    expect(dbMock.payment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", providerPaymentId: { not: null }, createdAt: { lte: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("detecta divergência PENDING sem corrigir sozinho", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({
      checked: 1,
      mismatches: [
        { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false },
      ],
    });
    expect(dbMock.payment.update).not.toHaveBeenCalled();
  });

  it("não reporta nada quando o status do gateway bate com o local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PENDING"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({ checked: 1, mismatches: [] });
  });

  it("continua processando os demais pagamentos PENDING quando um falha ao consultar o gateway", async () => {
    dbMock.payment.findMany
      .mockResolvedValueOnce([{ ...pendingFixture, id: "payment-1" }, { ...pendingFixture, id: "payment-4", providerPaymentId: "mp-4" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const checkPaymentStatus = vi.fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce("PAID");
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      checked: 2,
      mismatches: [
        { paymentId: "payment-4", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false },
      ],
    });
  });

  it("corrige automaticamente um PAID que o gateway diz estar REFUNDED", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("REFUNDED"),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.$transaction).toHaveBeenCalled();
    expect(dbMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-2" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(result.mismatches).toEqual([
      { paymentId: "payment-2", orderId: "order-2", eventTitle: "Corrida Paga", localStatus: "PAID", gatewayStatus: "REFUNDED", corrected: true },
    ]);
  });

  it("corrige automaticamente um PAID que o gateway diz estar em CHARGEBACK", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("CHARGEBACK"),
    } as any);

    const result = await reconcilePayments();

    expect(result.mismatches[0]).toEqual(
      expect.objectContaining({ gatewayStatus: "CHARGEBACK", corrected: true }),
    );
  });

  it("não mexe num pagamento PAID cujo status no gateway ainda é PAID", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.payment.update).not.toHaveBeenCalled();
    expect(result.mismatches).toEqual([]);
  });

  it("reativa um pagamento EXPIRED que o gateway diz estar PAID (aprovação atrasada)", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([expiredFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.order.update).toHaveBeenCalledWith({ where: { id: "order-3" }, data: { status: "PAID" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-2" }, data: { soldCount: { increment: 1 } } });
    expect(result.mismatches).toEqual([
      { paymentId: "payment-3", orderId: "order-3", eventTitle: "Corrida Expirada", localStatus: "EXPIRED", gatewayStatus: "PAID", corrected: true },
    ]);
  });

  it("soma o total verificado das 3 varreduras", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([expiredFixture]);
    // Cada verificação bate com o status local (sem divergência) — só valida a soma do "checked".
    const checkPaymentStatus = vi.fn()
      .mockResolvedValueOnce("PENDING")
      .mockResolvedValueOnce("PAID")
      .mockResolvedValueOnce("EXPIRED");
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(result.checked).toBe(3);
    expect(result.mismatches).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/payment-reconciliation.test.ts`
Expected: FAIL — `reconcilePayments()` ainda só faz 1 chamada a `db.payment.findMany` (as
verificações `toHaveBeenNthCalledWith(1, ...)` funcionam, mas os testes de PAID/EXPIRED não têm o
que verificar ainda) e `PaymentMismatch` não tem `corrected`.

- [ ] **Step 3: Reescrever `lib/payment/reconciliation.ts`**

```ts
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";
import { applyGatewayStatus } from "./sync-payment-status";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
  corrected: boolean;
}

const PAID_LOOKBACK_DAYS = 90;
const LATE_APPROVAL_LOOKBACK_DAYS = 7;

type Provider = Awaited<ReturnType<typeof getPaymentProvider>>;

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const settings = await getReconciliationAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);
  const organizerFilter = options?.organizerUserId
    ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
    : {};

  const provider = await getPaymentProvider();

  const pending = await checkPendingMismatches(provider, cutoff, organizerFilter);
  const paid = await checkPaidMismatches(provider, organizerFilter);
  const lateApproval = await checkLateApprovalMismatches(provider, organizerFilter);

  return {
    checked: pending.checked + paid.checked + lateApproval.checked,
    mismatches: [...pending.mismatches, ...paid.mismatches, ...lateApproval.mismatches],
  };
}

async function checkPendingMismatches(
  provider: Provider,
  cutoff: Date,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      order: { select: { id: true, event: { select: { title: true } } } },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus !== payment.status) {
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: false,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check pending payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}

async function checkPaidMismatches(
  provider: Provider,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const cutoff = new Date(Date.now() - PAID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      providerPaymentId: { not: null },
      paidAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
        await db.$transaction(async (tx) => {
          await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "reconciliation");
        });
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check paid payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}

async function checkLateApprovalMismatches(
  provider: Provider,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const cutoff = new Date(Date.now() - LATE_APPROVAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: { in: ["EXPIRED", "CANCELLED"] },
      providerPaymentId: { not: null },
      updatedAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus === "PAID") {
        await db.$transaction(async (tx) => {
          await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "reconciliation");
        });
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check late-approval payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/payment-reconciliation.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Atualizar o template de e-mail (`lib/email.ts`)**

Localize `sendReconciliationMismatchEmail` e substitua por:

```ts
export async function sendReconciliationMismatchEmail(params: {
  to: string;
  mismatches: { paymentId: string; orderId: string; eventTitle: string; localStatus: string; gatewayStatus: string; corrected: boolean }[];
}): Promise<void> {
  const appName = await getAppName();
  const correctedCount = params.mismatches.filter((m) => m.corrected).length;
  const manualCount = params.mismatches.length - correctedCount;
  const rows = params.mismatches
    .map(
      (m) =>
        `<tr><td>${m.eventTitle}</td><td>${m.orderId}</td><td>${m.localStatus}</td><td>${m.gatewayStatus}</td><td>${m.corrected ? "Corrigido automaticamente" : "Requer verificação manual"}</td></tr>`,
    )
    .join("");
  await sendMail({
    to: params.to,
    subject: `Conciliação de pagamentos — ${params.mismatches.length} divergência(s) encontrada(s)`,
    html: layout(
      appName,
      `<p>A rotina de conciliação encontrou divergências entre o status local e o status no gateway de
       pagamento (${correctedCount} corrigida(s) automaticamente, ${manualCount} precisa(m) de revisão
       manual):</p>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <thead><tr><th>Evento</th><th>Pedido</th><th>Status local</th><th>Status no gateway</th><th>Situação</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       <p>Divergências marcadas como "Requer verificação manual" precisam de revisão em Admin →
       Conciliação.</p>`
    ),
  });
}
```

- [ ] **Step 6: Atualizar a mensagem de WhatsApp (`lib/alerts/reconciliation.ts`)**

Substitua a linha da mensagem de WhatsApp por:

```ts
    if (settings.whatsappEnabled) {
      const correctedCount = mismatches.filter((m) => m.corrected).length;
      const manualCount = mismatches.length - correctedCount;
      for (const admin of admins) {
        if (!admin.phone) continue;
        try {
          await sendWhatsAppMessage(
            admin.phone,
            `Conciliação de pagamentos: ${correctedCount} corrigida(s) automaticamente, ${manualCount} precisam de revisão manual. Acesse /admin/conciliacao para detalhes.`,
          );
        } catch (err) {
          console.error("[notifyReconciliationMismatches] whatsapp failed for", admin.phone, err);
        }
      }
    }
```

- [ ] **Step 7: Atualizar `components/payment/ReconciliationPanel.tsx`**

Adicione o campo `corrected` na interface `Mismatch` e uma coluna na tabela:

```tsx
interface Mismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
  corrected: boolean;
}
```

Na `<thead>`, adicione a coluna:

```tsx
                  <th className="pb-2">Status no gateway</th>
                  <th className="pb-2 pl-4">Situação</th>
```

(substitua a última `<th className="pb-2">Status no gateway</th>` que já existe, adicionando a nova
coluna depois dela) e no `<tbody>`, adicione a célula correspondente ao final de cada `<tr>`:

```tsx
                    <td className="py-2">{m.gatewayStatus}</td>
                    <td className="py-2 pl-4">
                      {m.corrected ? (
                        <span className="text-green-700 dark:text-green-400 text-xs font-medium">Corrigido automaticamente</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 text-xs font-medium">Requer revisão manual</span>
                      )}
                    </td>
```

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam (o teste de `alert-reconciliation.test.ts` usa `expect.any(String)`
para a mensagem de WhatsApp, então continua passando sem alteração).

- [ ] **Step 9: Commit**

```bash
git add lib/payment/reconciliation.ts tests/payment-reconciliation.test.ts lib/email.ts lib/alerts/reconciliation.ts components/payment/ReconciliationPanel.tsx
git commit -m "feat: conciliacao detecta e corrige estorno externo e aprovacao atrasada"
```

---

### Task 4: Botão de estornar detecta estorno externo antes de chamar o gateway

**Files:**
- Modify: `lib/payment/refund-service.ts`
- Modify: `tests/refund-service.test.ts`
- Modify: `app/api/admin/payments/[id]/refund/route.ts`
- Modify: `app/api/organizer/registrations/[id]/refund/route.ts`

**Interfaces:**
- Consumes: `applyGatewayStatus(tx, payment, order, registrations, newStatus, "refund_check")` da
  Task 1.
- Produces: `refundPayment()` passa a retornar `Promise<{ alreadySynced: boolean }>` (antes era
  `Promise<void>`). As duas rotas passam esse campo adiante na resposta JSON:
  `{ success: true, alreadySynced: boolean }`.

- [ ] **Step 1: Atualizar os testes existentes e escrever os novos (falhando)**

Em `tests/refund-service.test.ts`, atualize os 3 testes que chegam a chamar o gateway — adicione
`checkPaymentStatus` ao mock do provider e ajuste as expectativas de retorno. Substitua o teste
`"does not write anything when the gateway call fails"` por:

```ts
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
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
      refundPayment: refundPaymentGateway,
    } as any);

    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "gateway down",
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
```

Substitua `"cancels a still-confirmed registration and decrements soldCount on success"` por (só o
mock do provider ganha `checkPaymentStatus`; o resto do teste é idêntico):

```ts
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
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
      refundPayment: refundPaymentGateway,
    } as any);

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

    const result = await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1", reason: "atleta desistiu" });

    expect(result).toEqual({ alreadySynced: false });
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
```

Substitua `"does not touch an already-cancelled registration a second time"` por (só o mock do
provider ganha `checkPaymentStatus`):

```ts
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
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
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
```

Adicione um teste novo ao final do arquivo, antes do `});` que fecha o `describe`:

```ts
  it("sincroniza localmente e não chama o gateway de novo quando já está estornado lá", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: {
        id: "ord-1",
        status: "PAID",
        registrations: [{ id: "reg-1", ticketBatchId: "tb-1" }],
      },
    });
    const refundPaymentGateway = vi.fn();
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("REFUNDED"),
      refundPayment: refundPaymentGateway,
    } as any);

    const txPaymentUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { update: txPaymentUpdate },
        order: { update: vi.fn() },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" });

    expect(result).toEqual({ alreadySynced: true });
    expect(refundPaymentGateway).not.toHaveBeenCalled();
    expect(txPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay-1" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/refund-service.test.ts`
Expected: FAIL — `refundPayment()` ainda não chama `checkPaymentStatus` nem retorna
`{ alreadySynced }`.

- [ ] **Step 3: Reescrever `lib/payment/refund-service.ts`**

```ts
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { applyGatewayStatus } from "./sync-payment-status";

export interface RefundPaymentParams {
  paymentId: string;
  initiatedByUserId: string;
  reason?: string;
}

export interface RefundPaymentResult {
  alreadySynced: boolean;
}

export async function refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: { include: { registrations: true } } },
  });

  if (!payment) throw new Error("Pagamento não encontrado");
  if (payment.status !== "PAID") throw new Error("Só é possível estornar pagamentos com status Pago");
  if (!payment.providerPaymentId) throw new Error("Pagamento sem referência no gateway");

  const provider = await getPaymentProvider();

  const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId);
  if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
    await db.$transaction(async (tx) => {
      await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "refund_check");
    });
    return { alreadySynced: true };
  }

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

  return { alreadySynced: false };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/refund-service.test.ts`
Expected: PASS (todos os testes)

- [ ] **Step 5: Repassar `alreadySynced` nas duas rotas**

Em `app/api/admin/payments/[id]/refund/route.ts`, troque:

```ts
  try {
    await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true });
  } catch (error) {
```

por:

```ts
  try {
    const result = await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true, alreadySynced: result.alreadySynced });
  } catch (error) {
```

Em `app/api/organizer/registrations/[id]/refund/route.ts`, faça a mesma troca (mesmo trecho, mesma
substituição).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 7: Rodar `tsc` para garantir que os tipos batem**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add lib/payment/refund-service.ts tests/refund-service.test.ts app/api/admin/payments/\[id\]/refund/route.ts app/api/organizer/registrations/\[id\]/refund/route.ts
git commit -m "fix: botao de estornar detecta estorno externo antes de chamar o gateway"
```
