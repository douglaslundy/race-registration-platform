# Cancelamento com Aprovação, Estorno Automático e Fila de Pendências — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o ciclo de cancelamento de inscrições: motivo sempre obrigatório, aprovação com estorno automático (com fallback manual em caso de falha do gateway), notificação a admin/organizador por e-mail e WhatsApp, uma fila de pendências, e status de reembolso visível na listagem de inscritos.

**Architecture:** O fluxo condicional existente (`cancellationRequiresApproval` por evento + `cancellation_policy_enabled` global, decidido por `decideCancellationOutcome`) permanece intacto. A única mudança no caminho sem aprovação é tornar o motivo obrigatório. No caminho com aprovação, a lógica de decisão é extraída para um serviço compartilhado (`decideRegistrationCancellation`) reutilizado por rotas finas de admin e organizador, que agora também tenta um estorno automático resiliente (`attemptAutoRefund` — nunca lança exceção, cai para `Payment.status = REFUND_PENDING` em caso de falha). Uma nova tabela de leitura (`lib/registrations/pending-queue.ts`) alimenta duas páginas novas (admin e organizador). Notificação segue o padrão já estabelecido em `lib/alerts/*.ts` (settings por canal + dedupe).

**Tech Stack:** Next.js (App Router) + Prisma + PostgreSQL + Vitest. Sem biblioteca de testes de componente React no projeto — componentes de UI são verificados manualmente via `npm run dev` + navegador, não por teste automatizado.

## Global Constraints

- O toggle global `cancellation_policy_enabled` e o campo por evento `Event.cancellationRequiresApproval` **não são removidos nem alterados em comportamento** — seguem decidindo entre `cancel_immediately` e `requires_approval`.
- `Event.cancellationDeadline` (prazo de cancelamento) segue funcionando exatamente como hoje.
- Motivo (`reason`) do cancelamento passa a ser **sempre obrigatório**, em qualquer outcome (`cancel_immediately` ou `requires_approval`).
- Todo estorno é do **valor integral** do pagamento — sem estorno parcial.
- `Event.cancellationContactEmail` / `cancellationContactPhone` ficam sem uso após este plano (órfãos no schema) — não remover, fora de escopo.
- O botão direto "Estornar" (`RefundRegistrationButton` / `RefundPaymentButton`, rotas `/api/organizer/registrations/[id]/refund` e `/api/admin/payments/[id]/refund`) **não muda de comportamento** — continua lançando exceção e mostrando `alert()` em caso de falha do gateway. O fallback resiliente (`REFUND_PENDING`) só existe na aprovação de cancelamento.
- Sem biblioteca de teste de componente React instalada — não criar arquivos `.test.tsx`. Tarefas de UI pura são verificadas manualmente (dev server + clique na interface), não com `npm test`.

---

### Task 1: Schema — `RefundStatus`, `Payment.REFUND_PENDING`, campos novos em `Refund`

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/setup.ts`
- Test: nenhum teste automatizado dedicado — validado pela compilação do Prisma Client e pelos testes das tasks seguintes, que dependem destes campos.

**Interfaces:**
- Produces: enum `RefundStatus` com valores `"PROCESSED" | "FAILED" | "MANUAL"`; `Payment.status` ganha o valor `"REFUND_PENDING"`; `Refund.status: RefundStatus` (sem `@default`, sempre setado explicitamente na criação), `Refund.failureReason: string | null`, `Refund.resolutionNote: string | null`.

- [ ] **Step 1: Editar `prisma/schema.prisma`**

Em `enum PaymentStatus` (linha ~68), adicionar o novo valor:

```prisma
enum PaymentStatus {
  PENDING
  PAID
  EXPIRED
  CANCELLED
  REFUNDED
  CHARGEBACK
  REFUND_PENDING
}
```

Logo antes de `model Refund` (linha ~391), adicionar o novo enum:

```prisma
enum RefundStatus {
  PROCESSED
  FAILED
  MANUAL
}
```

Substituir o `model Refund` inteiro por:

```prisma
model Refund {
  id                String       @id @default(cuid())
  paymentId         String
  amount            Int       // centavos
  reason            String?
  status            RefundStatus
  failureReason     String?
  resolutionNote    String?
  providerRefundId  String?
  initiatedByUserId String
  processedAt       DateTime?
  createdAt         DateTime     @default(now())

  payment         Payment @relation(fields: [paymentId], references: [id])
  initiatedByUser User    @relation(fields: [initiatedByUserId], references: [id])

  @@map("refunds")
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `npx prisma migrate dev --name refund_status_and_pending_refund`
Expected: cria uma nova pasta em `prisma/migrations/`, aplica no banco de desenvolvimento e regenera o Prisma Client sem erros.

- [ ] **Step 3: Atualizar o mock global do Prisma em `tests/setup.ts`**

Trocar a linha:

```ts
    refund: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn() },
```

por:

```ts
    refund: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
```

- [ ] **Step 4: Rodar a suíte inteira para confirmar que nada quebrou com a mudança de schema**

Run: `npm test`
Expected: mesma quantidade de falhas/sucessos de antes desta task (a Task 2 corrige a única falha esperada, em `refund-service.test.ts`, causada pelo novo campo `status` obrigatório em `Refund`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/setup.ts
git commit -m "feat: add RefundStatus enum and REFUND_PENDING payment status"
```

---

### Task 2: `refundPayment` grava `status: "PROCESSED"` no `Refund` que cria

**Files:**
- Modify: `lib/payment/refund-service.ts:37-47`
- Test: `tests/refund-service.test.ts:96-104`

**Interfaces:**
- Consumes: `RefundStatus` (Task 1).
- Produces: nenhuma mudança de assinatura — `refundPayment` continua exportando `RefundPaymentParams`/`RefundPaymentResult` como hoje, apenas o registro `Refund` criado agora inclui `status: "PROCESSED"`.

- [ ] **Step 1: Atualizar o teste que verifica a criação do `Refund` de sucesso**

Em `tests/refund-service.test.ts`, dentro do teste `"cancels a still-confirmed registration and decrements soldCount on success"`, ajustar a asserção:

```ts
    expect(txRefundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: "pay-1",
        amount: 1000,
        reason: "atleta desistiu",
        status: "PROCESSED",
        providerRefundId: "mp-refund-1",
        initiatedByUserId: "user-1",
      }),
    });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (campo `status` ainda não é enviado pelo código)**

Run: `npx vitest run tests/refund-service.test.ts -t "cancels a still-confirmed registration"`
Expected: FAIL — `expect(txRefundCreate).toHaveBeenCalledWith` não bate porque falta `status: "PROCESSED"` no objeto real.

- [ ] **Step 3: Atualizar `refund-service.ts`**

Em `lib/payment/refund-service.ts`, dentro do `db.$transaction`, mudar:

```ts
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
```

para:

```ts
    await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: params.reason,
        status: "PROCESSED",
        processedAt: new Date(),
        providerRefundId: result.providerRefundId,
        initiatedByUserId: params.initiatedByUserId,
      },
    });
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run tests/refund-service.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add lib/payment/refund-service.ts tests/refund-service.test.ts
git commit -m "feat: record RefundStatus.PROCESSED on successful gateway refund"
```

---

### Task 3: Motivo do cancelamento sempre obrigatório (atleta)

**Files:**
- Modify: `app/api/registrations/[id]/cancel/route.ts`
- Modify: `components/dashboard/CancelRegistrationButton.tsx`
- Test: `tests/registration-cancel-route.test.ts`

**Interfaces:**
- Produces: `POST /api/registrations/[id]/cancel` passa a retornar 400 com `{ error: "Justificativa obrigatória para cancelar a inscrição" }` sempre que `reason` estiver vazio, em qualquer outcome. No branch `cancel_immediately`, `Registration.cancellationReason` passa a ser gravado.

- [ ] **Step 1: Escrever o teste que falha — motivo exigido também no cancelamento imediato**

Em `tests/registration-cancel-route.test.ts`, adicionar um novo `it` logo após o teste `"cancela imediatamente quando o interruptor global está desligado..."`:

```ts
  it("exige justificativa mesmo no cancelamento imediato (sem aprovação)", async () => {
    policyMock.mockResolvedValue(false);
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Justificativa obrigatória para cancelar a inscrição");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
```

E atualizar o teste existente `"cancela imediatamente quando o interruptor global está desligado (comportamento atual preservado)"` para enviar um motivo (senão ele passa a falhar com 400) e verificar que é persistido:

```ts
  it("cancela imediatamente quando o interruptor global está desligado (comportamento atual preservado)", async () => {
    policyMock.mockResolvedValue(false);
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ reason: "Não poderei mais participar" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { status: "CANCELLED", cancellationReason: "Não poderei mais participar" },
    });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REGISTRATION_CANCELLED",
          metadata: expect.objectContaining({ reason: "Não poderei mais participar" }),
        }),
      }),
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/registration-cancel-route.test.ts`
Expected: FAIL nos dois testes acima (a rota ainda não exige motivo fora do branch `requires_approval`, e não grava `cancellationReason` no branch imediato).

- [ ] **Step 3: Atualizar `app/api/registrations/[id]/cancel/route.ts`**

Substituir o corpo do handler (a partir da linha 12) por:

```ts
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          startAt: true,
          title: true,
          cancellationDeadline: true,
          cancellationRequiresApproval: true,
          cancellationContactEmail: true,
        },
      },
      order: { select: { id: true, status: true } },
    },
  });

  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Somente inscrições confirmadas podem ser canceladas" }, { status: 400 });
  }

  if (new Date(registration.event.startAt) <= new Date()) {
    return NextResponse.json({ error: "Não é possível cancelar após o início do evento" }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ error: "Justificativa obrigatória para cancelar a inscrição" }, { status: 400 });
  }

  const policyEnabled = await getCancellationPolicyEnabled();
  const decision = decideCancellationOutcome({
    policyEnabled,
    cancellationDeadline: registration.event.cancellationDeadline,
    cancellationRequiresApproval: registration.event.cancellationRequiresApproval,
    now: new Date(),
  });

  if (decision.outcome === "blocked_deadline_passed") {
    return NextResponse.json({ error: "Prazo de cancelamento encerrado" }, { status: 400 });
  }

  if (decision.outcome === "requires_approval") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: {
          status: "CANCELLATION_REQUESTED",
          cancellationReason: reason,
          cancellationRequestedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_REQUESTED",
          entityType: "Registration",
          entityId: id,
          metadata: { eventTitle: registration.event.title, reason },
        },
      });
    });

    void notifyCancellationRequested(id);

    return NextResponse.json({ success: true, status: "CANCELLATION_REQUESTED" });
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id },
      data: { status: "CANCELLED", cancellationReason: reason },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "CANCELLED" },
    });

    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_CANCELLED",
        entityType: "Registration",
        entityId: id,
        metadata: { eventTitle: registration.event.title, orderId: registration.order.id, reason },
      },
    });
  });

  return NextResponse.json({ success: true });
```

(A Task 9 troca `notifyCancellationRequested` pelo novo alerta — por ora deixe o import como está.)

- [ ] **Step 4: Confirmar que o teste `"vira solicitação..."` continua batendo (motivo já era obrigatório nesse branch, sem mudança de comportamento) e rodar tudo**

Run: `npx vitest run tests/registration-cancel-route.test.ts`
Expected: PASS em todos os testes do arquivo.

- [ ] **Step 5: Atualizar `CancelRegistrationButton` para sempre exigir o motivo**

Editar `components/dashboard/CancelRegistrationButton.tsx`: remover a condicional `{requiresApproval && (...)}` ao redor do `<textarea>` e o `requiresApproval &&` do `disabled`, deixando o campo sempre visível e sempre obrigatório:

```tsx
  if (confirming) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justifique o motivo do cancelamento"
          className="input-field text-sm"
          rows={3}
        />
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={loading || !reason.trim()}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Confirmar cancelamento"}
          </button>
          <button onClick={() => setConfirming(false)} className="btn-secondary text-sm px-3">
            Voltar
          </button>
        </div>
      </div>
    );
  }
```

O restante do componente (o `body: JSON.stringify({ reason: reason.trim() || undefined })` no `handleCancel`) não precisa mudar — como o botão de confirmar agora só fica habilitado com texto, `reason.trim()` nunca será vazio nesse ponto.

- [ ] **Step 6: Verificação manual (sem teste automatizado de componente)**

Run: `npm run dev`, acessar `/dashboard/inscricoes/[id]` de uma inscrição `CONFIRMED` de teste, clicar em "Cancelar inscrição".
Expected: o campo de justificativa aparece sempre (independente da configuração do evento), e o botão "Confirmar cancelamento" só habilita com texto digitado.

- [ ] **Step 7: Commit**

```bash
git add app/api/registrations/\[id\]/cancel/route.ts components/dashboard/CancelRegistrationButton.tsx tests/registration-cancel-route.test.ts
git commit -m "feat: require cancellation reason on every registration cancellation"
```

---

### Task 4: `attemptAutoRefund` — estorno automático resiliente

**Files:**
- Create: `lib/payment/auto-refund.ts`
- Test: `tests/auto-refund.test.ts`

**Interfaces:**
- Consumes: `refundPayment` de `lib/payment/refund-service.ts` (`{ paymentId, initiatedByUserId, reason? }): Promise<{ alreadySynced: boolean }>`; `db` de `@/lib/db`.
- Produces: `attemptAutoRefund(params: { payment: { id: string; amount: number }; initiatedByUserId: string; reason?: string }): Promise<{ outcome: "processed" | "already_synced" | "failed"; failureReason?: string }>` — usado pela Task 5.

- [ ] **Step 1: Escrever o teste (arquivo novo)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";

vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { attemptAutoRefund } from "@/lib/payment/auto-refund";

const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

describe("attemptAutoRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 'processed' e não escreve nada extra quando o gateway confirma o estorno", async () => {
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false });

    const result = await attemptAutoRefund({
      payment: { id: "pay-1", amount: 1000 },
      initiatedByUserId: "org-1",
      reason: "Contusão",
    });

    expect(result).toEqual({ outcome: "processed" });
    expect(refundPaymentMock).toHaveBeenCalledWith({ paymentId: "pay-1", initiatedByUserId: "org-1", reason: "Contusão" });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 'already_synced' quando o gateway já tinha processado o estorno antes", async () => {
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: true });

    const result = await attemptAutoRefund({ payment: { id: "pay-1", amount: 1000 }, initiatedByUserId: "org-1" });

    expect(result).toEqual({ outcome: "already_synced" });
  });

  it("quando o gateway falha, grava Refund FAILED, marca o pagamento como REFUND_PENDING e não lança exceção", async () => {
    refundPaymentMock.mockRejectedValueOnce(new Error("gateway indisponível"));
    const txRefundCreate = vi.fn();
    const txPaymentUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ refund: { create: txRefundCreate }, payment: { update: txPaymentUpdate } }),
    );

    const result = await attemptAutoRefund({
      payment: { id: "pay-1", amount: 1000 },
      initiatedByUserId: "org-1",
      reason: "Contusão",
    });

    expect(result).toEqual({ outcome: "failed", failureReason: "gateway indisponível" });
    expect(txRefundCreate).toHaveBeenCalledWith({
      data: {
        paymentId: "pay-1",
        amount: 1000,
        reason: "Contusão",
        status: "FAILED",
        failureReason: "gateway indisponível",
        initiatedByUserId: "org-1",
      },
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { status: "REFUND_PENDING" } });
  });

  it("usa uma mensagem padrão de erro quando o gateway lança algo que não é um Error", async () => {
    refundPaymentMock.mockRejectedValueOnce("timeout cru");
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ refund: { create: vi.fn() }, payment: { update: vi.fn() } }),
    );

    const result = await attemptAutoRefund({ payment: { id: "pay-1", amount: 1000 }, initiatedByUserId: "org-1" });

    expect(result).toEqual({ outcome: "failed", failureReason: "Erro desconhecido ao estornar" });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (módulo ainda não existe)**

Run: `npx vitest run tests/auto-refund.test.ts`
Expected: FAIL — `Cannot find module '@/lib/payment/auto-refund'`.

- [ ] **Step 3: Criar `lib/payment/auto-refund.ts`**

```ts
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";

export interface AttemptAutoRefundParams {
  payment: { id: string; amount: number };
  initiatedByUserId: string;
  reason?: string;
}

export type AttemptAutoRefundResult =
  | { outcome: "processed" | "already_synced" }
  | { outcome: "failed"; failureReason: string };

/**
 * Tenta estornar automaticamente via gateway. Ao contrário de `refundPayment`,
 * nunca lança exceção: se o gateway falhar, marca o pagamento como
 * REFUND_PENDING e registra um Refund FAILED para resolução manual depois
 * (ver lib/payment/manual-refund-resolution.ts).
 */
export async function attemptAutoRefund(params: AttemptAutoRefundParams): Promise<AttemptAutoRefundResult> {
  try {
    const result = await refundPayment({
      paymentId: params.payment.id,
      initiatedByUserId: params.initiatedByUserId,
      reason: params.reason,
    });
    return { outcome: result.alreadySynced ? "already_synced" : "processed" };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Erro desconhecido ao estornar";

    await db.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          paymentId: params.payment.id,
          amount: params.payment.amount,
          reason: params.reason,
          status: "FAILED",
          failureReason,
          initiatedByUserId: params.initiatedByUserId,
        },
      });

      await tx.payment.update({
        where: { id: params.payment.id },
        data: { status: "REFUND_PENDING" },
      });
    });

    return { outcome: "failed", failureReason };
  }
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/auto-refund.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add lib/payment/auto-refund.ts tests/auto-refund.test.ts
git commit -m "feat: add resilient auto-refund attempt with REFUND_PENDING fallback"
```

---

### Task 5: `decideRegistrationCancellation` — serviço compartilhado de aprovação/rejeição

**Files:**
- Create: `lib/registrations/cancellation-decision-service.ts`
- Test: `tests/cancellation-decision-service.test.ts`

**Interfaces:**
- Consumes: `attemptAutoRefund` (Task 4) com assinatura `{ payment: { id, amount }, initiatedByUserId, reason? } => Promise<{ outcome: "processed"|"already_synced"|"failed"; failureReason?: string }>`.
- Produces: `decideRegistrationCancellation(params: { where: Prisma.RegistrationWhereInput; decision: "APPROVE" | "REJECT"; actingUserId: string }): Promise<DecisionResult>` onde:
  ```ts
  type DecisionResult =
    | { ok: true; refund?: "processed" | "already_synced" | "failed" | "not_applicable" }
    | { ok: false; status: number; error: string };
  ```
  Usado pela Task 6 (rotas de admin e organizador).

- [ ] **Step 1: Escrever o teste (arquivo novo)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { attemptAutoRefund } from "@/lib/payment/auto-refund";

vi.mock("@/lib/payment/auto-refund", () => ({ attemptAutoRefund: vi.fn() }));

import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";

const dbMock = db as any;
const attemptAutoRefundMock = vi.mocked(attemptAutoRefund);

const baseRegistration = {
  id: "reg-1",
  status: "CANCELLATION_REQUESTED",
  ticketBatchId: "tb-1",
  orderId: "ord-1",
  cancellationReason: "Contusão no joelho",
  order: { payments: [] as { id: string; amount: number }[] },
};

describe("decideRegistrationCancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 quando a inscrição não é encontrada no escopo informado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Inscrição não encontrada" });
  });

  it("retorna 400 quando a inscrição não está com solicitação pendente", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...baseRegistration, status: "CANCELLED" });

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "user-1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Esta inscrição não possui uma solicitação de cancelamento pendente",
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("REJECT volta a inscrição para CONFIRMED e não tenta estornar", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ registration: { update: txRegistrationUpdate }, auditLog: { create: txAuditLogCreate } }),
    );

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "REJECT",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REJECTED" }) }),
    );
    expect(attemptAutoRefundMock).not.toHaveBeenCalled();
  });

  it("APPROVE sem pagamento PAID cancela a inscrição e retorna refund 'not_applicable'", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "not_applicable" });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(attemptAutoRefundMock).not.toHaveBeenCalled();
  });

  it("APPROVE com pagamento PAID tenta o estorno automático e repassa o resultado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      order: { payments: [{ id: "pay-1", amount: 5000 }] },
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: vi.fn() },
        order: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
    attemptAutoRefundMock.mockResolvedValueOnce({ outcome: "failed", failureReason: "gateway indisponível" });

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "failed" });
    expect(attemptAutoRefundMock).toHaveBeenCalledWith({
      payment: { id: "pay-1", amount: 5000 },
      initiatedByUserId: "org-1",
      reason: "Contusão no joelho",
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/cancellation-decision-service.test.ts`
Expected: FAIL — módulo `@/lib/registrations/cancellation-decision-service` não existe.

- [ ] **Step 3: Criar `lib/registrations/cancellation-decision-service.ts`**

```ts
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { attemptAutoRefund } from "@/lib/payment/auto-refund";

export type CancellationDecisionResult =
  | { ok: true; refund?: "processed" | "already_synced" | "failed" | "not_applicable" }
  | { ok: false; status: number; error: string };

export async function decideRegistrationCancellation(params: {
  where: Prisma.RegistrationWhereInput;
  decision: "APPROVE" | "REJECT";
  actingUserId: string;
}): Promise<CancellationDecisionResult> {
  const registration = await db.registration.findFirst({
    where: params.where,
    select: {
      id: true,
      status: true,
      ticketBatchId: true,
      orderId: true,
      cancellationReason: true,
      order: {
        select: {
          payments: {
            where: { status: "PAID" },
            orderBy: { paidAt: "desc" },
            take: 1,
            select: { id: true, amount: true },
          },
        },
      },
    },
  });

  if (!registration) {
    return { ok: false, status: 404, error: "Inscrição não encontrada" };
  }

  if (registration.status !== "CANCELLATION_REQUESTED") {
    return { ok: false, status: 400, error: "Esta inscrição não possui uma solicitação de cancelamento pendente" };
  }

  if (params.decision === "REJECT") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({ where: { id: registration.id }, data: { status: "CONFIRMED" } });
      await tx.auditLog.create({
        data: {
          userId: params.actingUserId,
          action: "REGISTRATION_CANCELLATION_REJECTED",
          entityType: "Registration",
          entityId: registration.id,
        },
      });
    });
    return { ok: true };
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({ where: { id: registration.id }, data: { status: "CANCELLED" } });
    await tx.order.update({ where: { id: registration.orderId }, data: { status: "CANCELLED" } });
    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actingUserId,
        action: "REGISTRATION_CANCELLATION_APPROVED",
        entityType: "Registration",
        entityId: registration.id,
      },
    });
  });

  const paidPayment = registration.order.payments[0];
  if (!paidPayment) return { ok: true, refund: "not_applicable" };

  const result = await attemptAutoRefund({
    payment: paidPayment,
    initiatedByUserId: params.actingUserId,
    reason: registration.cancellationReason ?? undefined,
  });

  return { ok: true, refund: result.outcome };
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/cancellation-decision-service.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add lib/registrations/cancellation-decision-service.ts tests/cancellation-decision-service.test.ts
git commit -m "feat: extract shared cancellation approval/rejection service with auto-refund"
```

---

### Task 6: Rotas finas de decisão (organizer + admin)

**Files:**
- Modify: `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`
- Create: `app/api/admin/registrations/[id]/cancellation-decision/route.ts`
- Modify: `tests/organizer-cancellation-decision-route.test.ts`
- Test: `tests/admin-cancellation-decision-route.test.ts`

**Interfaces:**
- Consumes: `decideRegistrationCancellation` (Task 5).
- Produces: `POST /api/organizer/registrations/[id]/cancellation-decision` e `POST /api/admin/registrations/[id]/cancellation-decision`, ambas recebendo `{ decision: "APPROVE" | "REJECT" }` e retornando `{ success: true, refund?: ... }` ou `{ error }`.

- [ ] **Step 1: Reescrever o teste da rota de organizador como teste fino (mocka o serviço)**

Substituir todo o conteúdo de `tests/organizer-cancellation-decision-route.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";
import { POST } from "@/app/api/organizer/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  decideRegistrationCancellation: vi.fn(),
}));

const authMock = vi.mocked(auth);
const decideMock = vi.mocked(decideRegistrationCancellation);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("retorna 400 para um corpo com decision inválida", async () => {
    const res = await POST(makeRequest({ decision: "MAYBE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("escopa a decisão às inscrições de eventos do organizador logado", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "processed" });
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    decideMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Inscrição não encontrada" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Inscrição não encontrada");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: FAIL — a rota atual ainda contém a lógica antiga, não chama `decideRegistrationCancellation`.

- [ ] **Step 3: Reescrever `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await decideRegistrationCancellation({
    where: { id, event: { organizer: { userId: session.user.id } } },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, refund: result.refund });
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar a rota de admin e seu teste**

`app/api/admin/registrations/[id]/cancellation-decision/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await decideRegistrationCancellation({
    where: { id },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, refund: result.refund });
}
```

`tests/admin-cancellation-decision-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";
import { POST } from "@/app/api/admin/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  decideRegistrationCancellation: vi.fn(),
}));

const authMock = vi.mocked(auth);
const decideMock = vi.mocked(decideRegistrationCancellation);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer inscrição)", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "not_applicable" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "not_applicable" });
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "admin-1" });
  });
});
```

- [ ] **Step 6: Rodar ambos os arquivos de teste**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts tests/admin-cancellation-decision-route.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add app/api/organizer/registrations/\[id\]/cancellation-decision/route.ts app/api/admin/registrations/\[id\]/cancellation-decision/route.ts tests/organizer-cancellation-decision-route.test.ts tests/admin-cancellation-decision-route.test.ts
git commit -m "feat: add admin cancellation-decision route, slim organizer route via shared service"
```

---

### Task 7: `resolveRefundManually` — estorno manual/externo

**Files:**
- Create: `lib/payment/manual-refund-resolution.ts`
- Test: `tests/manual-refund-resolution.test.ts`

**Interfaces:**
- Produces: `resolveRefundManually(params: { where: Prisma.PaymentWhereInput; resolvedByUserId: string; resolutionNote: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }>` — usado pela Task 8.

- [ ] **Step 1: Escrever o teste**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";

const dbMock = db as any;

describe("resolveRefundManually", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 quando o pagamento não é encontrado no escopo informado", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(null);

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Pagamento não encontrado" });
  });

  it("retorna 400 quando o pagamento não está com estorno pendente", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "PAID" });

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "nota",
    });

    expect(result).toEqual({ ok: false, status: 400, error: "Este pagamento não está com estorno pendente" });
  });

  it("retorna 400 quando não há registro de estorno FAILED para atualizar", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "REFUND_PENDING" });
    dbMock.refund.findFirst.mockResolvedValueOnce(null);

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "nota",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Nenhum registro de estorno pendente encontrado para este pagamento",
    });
  });

  it("marca o Refund como MANUAL e o Payment como REFUNDED", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "REFUND_PENDING" });
    dbMock.refund.findFirst.mockResolvedValueOnce({ id: "refund-1", status: "FAILED" });
    const txRefundUpdate = vi.fn();
    const txPaymentUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { update: txRefundUpdate },
        payment: { update: txPaymentUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });

    expect(result).toEqual({ ok: true });
    expect(txRefundUpdate).toHaveBeenCalledWith({
      where: { id: "refund-1" },
      data: expect.objectContaining({ status: "MANUAL", resolutionNote: "Estorno feito via PIX manual" }),
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "org-1", action: "PAYMENT_REFUND_MANUAL", entityType: "Payment", entityId: "pay-1" }),
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/manual-refund-resolution.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar `lib/payment/manual-refund-resolution.ts`**

```ts
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function resolveRefundManually(params: {
  where: Prisma.PaymentWhereInput;
  resolvedByUserId: string;
  resolutionNote: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const payment = await db.payment.findFirst({ where: params.where, select: { id: true, status: true } });
  if (!payment) return { ok: false, status: 404, error: "Pagamento não encontrado" };

  if (payment.status !== "REFUND_PENDING") {
    return { ok: false, status: 400, error: "Este pagamento não está com estorno pendente" };
  }

  const refund = await db.refund.findFirst({
    where: { paymentId: payment.id, status: "FAILED" },
    orderBy: { createdAt: "desc" },
  });
  if (!refund) {
    return { ok: false, status: 400, error: "Nenhum registro de estorno pendente encontrado para este pagamento" };
  }

  await db.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "MANUAL", processedAt: new Date(), resolutionNote: params.resolutionNote },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId: params.resolvedByUserId,
        action: "PAYMENT_REFUND_MANUAL",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { resolutionNote: params.resolutionNote },
      },
    });
  });

  return { ok: true };
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/manual-refund-resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/payment/manual-refund-resolution.ts tests/manual-refund-resolution.test.ts
git commit -m "feat: add manual/external refund resolution service"
```

---

### Task 8: Rotas de resolução manual (organizer + admin)

**Files:**
- Create: `app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts`
- Create: `app/api/admin/refunds/[paymentId]/manual-resolve/route.ts`
- Test: `tests/organizer-manual-refund-resolve-route.test.ts`
- Test: `tests/admin-manual-refund-resolve-route.test.ts`

**Interfaces:**
- Consumes: `resolveRefundManually` (Task 7).
- Produces: `POST /api/organizer/refunds/[paymentId]/manual-resolve` e `POST /api/admin/refunds/[paymentId]/manual-resolve`, corpo `{ resolutionNote: string }`, retornam `{ success: true }` ou `{ error }`.

- [ ] **Step 1: Escrever o teste da rota de organizador**

`tests/organizer-manual-refund-resolve-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/organizer/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando resolutionNote está vazio", async () => {
    const res = await POST(makeRequest({ resolutionNote: "   " }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(400);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("escopa a resolução aos pagamentos de eventos do organizador logado", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1", order: { event: { organizer: { userId: "org-1" } } } },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Pagamento não encontrado" });

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Pagamento não encontrado");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/organizer-manual-refund-resolve-route.test.ts`
Expected: FAIL — a rota ainda não existe.

- [ ] **Step 3: Criar `app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";

const schema = z.object({
  resolutionNote: z.string().trim().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId, order: { event: { organizer: { userId: session.user.id } } } },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/organizer-manual-refund-resolve-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar a rota de admin e seu teste**

`app/api/admin/refunds/[paymentId]/manual-resolve/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";

const schema = z.object({
  resolutionNote: z.string().trim().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
```

`tests/admin-manual-refund-resolve-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/admin/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer pagamento)", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });

    expect(res.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      resolvedByUserId: "admin-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });
});
```

- [ ] **Step 6: Rodar ambos**

Run: `npx vitest run tests/organizer-manual-refund-resolve-route.test.ts tests/admin-manual-refund-resolve-route.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add app/api/organizer/refunds app/api/admin/refunds tests/organizer-manual-refund-resolve-route.test.ts tests/admin-manual-refund-resolve-route.test.ts
git commit -m "feat: add manual refund resolution routes for organizer and admin"
```

---

### Task 9: Alerta de solicitação de cancelamento (e-mail + WhatsApp)

**Files:**
- Modify: `lib/alerts/alert-settings.ts`
- Create: `lib/alerts/cancellation-requested.ts`
- Modify: `app/api/registrations/[id]/cancel/route.ts:1-9` (import) e o branch `requires_approval` (Task 3)
- Modify: `lib/notifications.ts` (remover `notifyCancellationRequested`)
- Test: `tests/alert-cancellation-requested.test.ts`
- Modify: `tests/registration-cancel-route.test.ts` (trocar o mock de `@/lib/notifications` pelo novo módulo)

**Interfaces:**
- Consumes: `claimAlert`/`unclaimAlert` (`lib/alerts/dedupe.ts`), `sendCancellationRequestedEmail` (`lib/email.ts`, já existe), `sendWhatsAppMessage` (`lib/whatsapp.ts`, já existe).
- Produces: `getCancellationAlertSettings(): Promise<{ emailEnabled: boolean; whatsappEnabled: boolean }>`; `notifyCancellationRequested(registrationId: string): Promise<void>`.

- [ ] **Step 1: Adicionar as novas settings em `lib/alerts/alert-settings.ts`**

Ao final do arquivo, adicionar:

```ts
export interface CancellationAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getCancellationAlertSettings(): Promise<CancellationAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_cancellation_email_enabled"),
    getSetting("alert_cancellation_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}
```

- [ ] **Step 2: Escrever o teste do novo alerta**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCancellationRequestedEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getCancellationAlertSettings: vi.fn() }));
vi.mock("@/lib/alerts/dedupe", () => ({ claimAlert: vi.fn(), unclaimAlert: vi.fn() }));

import { notifyCancellationRequested } from "@/lib/alerts/cancellation-requested";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const registrationFixture = {
  cancellationReason: "Contusão no joelho",
  athlete: { name: "Atleta Teste" },
  event: {
    title: "Corrida Teste",
    organizer: { user: { email: "org@example.com", phone: "5511999998888" } },
  },
};

describe("notifyCancellationRequested (alerts/cancellation-requested)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.user.findMany.mockResolvedValue([{ email: "admin@example.com", phone: "5511988887777" }]);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyCancellationRequested("reg-1");

    expect(dbMock.registration.findUnique).not.toHaveBeenCalled();
  });

  it("envia e-mail para todos os admins e para o organizador do evento", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", athleteName: "Atleta Teste", reason: "Contusão no joelho" }),
    );
    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "org@example.com", athleteName: "Atleta Teste" }),
    );
  });

  it("envia WhatsApp para quem tem telefone cadastrado", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988887777", expect.stringContaining("Corrida Teste"));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999998888", expect.stringContaining("Corrida Teste"));
  });

  it("não lança exceção quando o envio de e-mail falha", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);
    vi.mocked(sendCancellationRequestedEmail).mockRejectedValue(new Error("SMTP down"));

    await expect(notifyCancellationRequested("reg-1")).resolves.toBeUndefined();
    expect(unclaimAlert).toHaveBeenCalled();
  });

  it("não faz nada quando a inscrição não é encontrada", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(null);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/alert-cancellation-requested.test.ts`
Expected: FAIL — módulo `@/lib/alerts/cancellation-requested` não existe.

- [ ] **Step 4: Criar `lib/alerts/cancellation-requested.ts`**

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const ALERT_TYPE = "CANCELLATION_REQUESTED";

/**
 * Avisa todos os admins e o organizador do evento que um atleta solicitou o
 * cancelamento da inscrição e precisa de aprovação. Seguro para "fire-and-forget":
 * nunca lança e ignora silenciosamente canais desligados ou não configurados.
 */
export async function notifyCancellationRequested(registrationId: string): Promise<void> {
  try {
    const settings = await getCancellationAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      select: {
        cancellationReason: true,
        athlete: { select: { name: true } },
        event: {
          select: {
            title: true,
            organizer: { select: { user: { select: { email: true, phone: true } } } },
          },
        },
      },
    });
    if (!registration) return;

    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, phone: true } });
    const recipients = [...admins, registration.event.organizer.user];
    const reason = registration.cancellationReason ?? "";

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const recipient of recipients) {
          const claimed = await claimAlert(ALERT_TYPE, "Registration", `${registrationId}:${recipient.email}`, "EMAIL");
          if (!claimed) continue;
          try {
            await sendCancellationRequestedEmail({
              to: recipient.email,
              athleteName: registration.athlete.name,
              eventTitle: registration.event.title,
              reason,
            });
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, `${registrationId}:${recipient.email}`, "EMAIL");
            console.error("[notifyCancellationRequested] email failed for", recipient.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const recipient of recipients) {
        if (!recipient.phone) continue;
        const claimed = await claimAlert(ALERT_TYPE, "Registration", `${registrationId}:${recipient.phone}`, "WHATSAPP");
        if (!claimed) continue;
        try {
          await sendWhatsAppMessage(
            recipient.phone,
            `${registration.athlete.name} solicitou o cancelamento da inscrição em "${registration.event.title}". Motivo: ${reason}. Acesse o painel para aprovar ou rejeitar.`,
          );
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, `${registrationId}:${recipient.phone}`, "WHATSAPP");
          console.error("[notifyCancellationRequested] whatsapp failed for", recipient.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyCancellationRequested] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/alert-cancellation-requested.test.ts`
Expected: PASS.

- [ ] **Step 6: Trocar o import na rota de cancelamento e remover a função antiga**

Em `app/api/registrations/[id]/cancel/route.ts`, trocar:

```ts
import { notifyCancellationRequested } from "@/lib/notifications";
```

por:

```ts
import { notifyCancellationRequested } from "@/lib/alerts/cancellation-requested";
```

Em `lib/notifications.ts`, remover a função `notifyCancellationRequested` (linhas 39-69) e o import de `sendCancellationRequestedEmail` que ficaria sem uso (mantendo `sendRegistrationConfirmationEmail` e `notifyOrderConfirmed` intactos).

Em `tests/registration-cancel-route.test.ts`, trocar:

```ts
vi.mock("@/lib/notifications", () => ({ notifyCancellationRequested: vi.fn() }));
```

por:

```ts
vi.mock("@/lib/alerts/cancellation-requested", () => ({ notifyCancellationRequested: vi.fn() }));
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos, incluindo `tests/registration-cancel-route.test.ts` e qualquer teste antigo de `lib/notifications.ts` que testasse `notifyCancellationRequested` (se existir, removê-lo junto).

- [ ] **Step 8: Commit**

```bash
git add lib/alerts/alert-settings.ts lib/alerts/cancellation-requested.ts lib/notifications.ts app/api/registrations/\[id\]/cancel/route.ts tests/alert-cancellation-requested.test.ts tests/registration-cancel-route.test.ts
git commit -m "feat: notify all admins and event organizer by email/WhatsApp on cancellation request"
```

---

### Task 10: Toggle do novo alerta em Admin → Alertas

**Files:**
- Modify: `app/admin/alertas/page.tsx`

**Interfaces:**
- Consumes: `getCancellationAlertSettings` (Task 9), `AlertConfigCard` (componente já existente, sem mudanças).

- [ ] **Step 1: Adicionar o import e a chamada**

```ts
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
  getReconciliationAlertSettings,
  getCancellationAlertSettings,
} from "@/lib/alerts/alert-settings";
```

```ts
  const [lowStock, abandonedCart, paymentError, reconciliation, cancellation] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
    getReconciliationAlertSettings(),
    getCancellationAlertSettings(),
  ]);
```

- [ ] **Step 2: Adicionar o card, ao final da lista**

```tsx
      <AlertConfigCard
        title="Solicitação de cancelamento"
        description="Avisa todos os admins e o organizador do evento quando um atleta solicita o cancelamento da inscrição e precisa de aprovação."
        emailKey="alert_cancellation_email_enabled"
        whatsappKey="alert_cancellation_whatsapp_enabled"
        currentEmailEnabled={cancellation.emailEnabled}
        currentWhatsappEnabled={cancellation.whatsappEnabled}
      />
```

- [ ] **Step 3: Verificação manual**

Run: `npm run dev`, acessar `/admin/alertas` logado como admin.
Expected: novo card "Solicitação de cancelamento" aparece com os toggles de e-mail/WhatsApp desligados por padrão, e ligá-los persiste (recarregar a página mantém o estado).

- [ ] **Step 4: Commit**

```bash
git add app/admin/alertas/page.tsx
git commit -m "feat: add cancellation-requested alert toggle to admin alerts page"
```

---

### Task 11: `pending-queue.ts` — leituras para a fila de pendências

**Files:**
- Create: `lib/registrations/pending-queue.ts`
- Test: `tests/pending-queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PendingCancellation {
    id: string;
    createdAt: Date;
    cancellationReason: string | null;
    cancellationRequestedAt: Date | null;
    athlete: { name: string; email: string };
    event: { id: string; title: string };
  }
  interface PendingRefund {
    id: string; // Payment.id
    amount: number;
    order: { id: string };
    event: { id: string; title: string };
    athlete: { name: string; email: string };
    latestFailedRefund: { failureReason: string | null; createdAt: Date } | null;
  }
  function listPendingCancellations(organizerUserId?: string): Promise<PendingCancellation[]>;
  function listPendingRefunds(organizerUserId?: string): Promise<PendingRefund[]>;
  ```
  Usadas pelas páginas da Task 15. Quando `organizerUserId` é informado, escopa por eventos daquele organizador; quando omitido, retorna de todos os eventos (uso do admin).

- [ ] **Step 1: Escrever o teste**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";

const dbMock = db as any;

describe("listPendingCancellations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem organizerUserId, busca CANCELLATION_REQUESTED em todos os eventos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await listPendingCancellations();

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "CANCELLATION_REQUESTED" } }),
    );
  });

  it("com organizerUserId, escopa por eventos daquele organizador", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await listPendingCancellations("org-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "CANCELLATION_REQUESTED", event: { organizer: { userId: "org-1" } } },
      }),
    );
  });
});

describe("listPendingRefunds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem organizerUserId, busca Payment REFUND_PENDING em todos os eventos", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await listPendingRefunds();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "REFUND_PENDING" } }),
    );
  });

  it("com organizerUserId, escopa por eventos daquele organizador", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await listPendingRefunds("org-1");

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "REFUND_PENDING", order: { event: { organizer: { userId: "org-1" } } } },
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/pending-queue.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar `lib/registrations/pending-queue.ts`**

```ts
import { db } from "@/lib/db";

export interface PendingCancellation {
  id: string;
  createdAt: Date;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  athlete: { name: string; email: string };
  event: { id: string; title: string };
}

export interface PendingRefund {
  id: string;
  amount: number;
  order: { id: string };
  event: { id: string; title: string };
  athlete: { name: string; email: string };
  latestFailedRefund: { failureReason: string | null; createdAt: Date } | null;
}

export async function listPendingCancellations(organizerUserId?: string): Promise<PendingCancellation[]> {
  const registrations = await db.registration.findMany({
    where: {
      status: "CANCELLATION_REQUESTED",
      ...(organizerUserId ? { event: { organizer: { userId: organizerUserId } } } : {}),
    },
    orderBy: { cancellationRequestedAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      cancellationReason: true,
      cancellationRequestedAt: true,
      athlete: { select: { name: true, email: true } },
      event: { select: { id: true, title: true } },
    },
  });
  return registrations;
}

export async function listPendingRefunds(organizerUserId?: string): Promise<PendingRefund[]> {
  const payments = await db.payment.findMany({
    where: {
      status: "REFUND_PENDING",
      ...(organizerUserId ? { order: { event: { organizer: { userId: organizerUserId } } } } : {}),
    },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      amount: true,
      order: {
        select: {
          id: true,
          event: { select: { id: true, title: true } },
          buyer: { select: { name: true, email: true } },
        },
      },
      refunds: {
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { failureReason: true, createdAt: true },
      },
    },
  });

  return payments.map((p) => ({
    id: p.id,
    amount: p.amount,
    order: { id: p.order.id },
    event: p.order.event,
    athlete: p.order.buyer,
    latestFailedRefund: p.refunds[0] ?? null,
  }));
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/pending-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registrations/pending-queue.ts tests/pending-queue.test.ts
git commit -m "feat: add pending cancellations/refunds read queries"
```

---

### Task 12: "Ver justificativa" e status "reembolso pendente" na listagem de inscritos

**Files:**
- Create: `components/registrations/CancellationReasonModal.tsx`
- Modify: `components/registrations/RegistrationsTable.tsx`
- Modify: `lib/organizer/registrations.ts:7-14,37-41`

**Interfaces:**
- Produces: `CancellationReasonModal({ athleteName: string; reason: string; requestedAt: Date | string | null }): JSX.Element` — reutilizado pela Task 15.

- [ ] **Step 1: Criar `components/registrations/CancellationReasonModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";

export default function CancellationReasonModal({
  athleteName,
  reason,
  requestedAt,
}: {
  athleteName: string;
  reason: string;
  requestedAt: Date | string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">
        Ver justificativa
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Justificativa de cancelamento</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {athleteName}
              {requestedAt ? ` · ${formatDate(requestedAt, "dd/MM/yyyy HH:mm")}` : ""}
            </p>
            <p className="mt-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{reason}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Adicionar os campos ao `RegistrationRow` e renderizar o botão + badge nova em `RegistrationsTable.tsx`**

Em `components/registrations/RegistrationsTable.tsx`, adicionar ao `import`:

```tsx
import CancellationReasonModal from "@/components/registrations/CancellationReasonModal";
```

Adicionar dois campos à interface `RegistrationRow` (junto aos já existentes `emergencyContactName`, etc.):

```ts
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
```

Substituir o cálculo de `statusInfo` dentro do `.map`:

```tsx
            const payment = r.order.payments[0];
            const isRefundPending = payment?.status === "REFUND_PENDING";
            const isRefunded = payment?.status === "REFUNDED" || payment?.status === "CHARGEBACK";
            const statusInfo = isRefundPending
              ? { label: "Cancelado — reembolso pendente", color: BADGE.orange }
              : isRefunded
                ? { label: "Estornado", color: BADGE.purple }
                : REGISTRATION_STATUS[r.status];
```

E, na célula de status (logo abaixo do `<span>` do badge), adicionar o botão de justificativa quando houver motivo registrado:

```tsx
                <td className="py-2 pr-3">
                  <span className={`px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                    {statusInfo?.label ?? r.status}
                  </span>
                  {r.cancellationReason && (
                    <div className="mt-1">
                      <CancellationReasonModal
                        athleteName={r.athlete.name}
                        reason={r.cancellationReason}
                        requestedAt={r.cancellationRequestedAt}
                      />
                    </div>
                  )}
                </td>
```

- [ ] **Step 3: Adicionar o filtro sintético `REFUND_PENDING` em `lib/organizer/registrations.ts`**

Adicionar `"REFUND_PENDING"` como opção de status reconhecida no filtro (sem entrar em `VALID_REGISTRATION_STATUSES`, que é para valores reais de `RegistrationStatus`):

```ts
export function buildRegistrationWhere(eventId: string, status?: string, q?: string): Prisma.RegistrationWhereInput {
  const query = q?.trim();
  const normalizedCpf = query ? normalizeCpf(query) : "";
  return {
    eventId,
    ...(status === "REFUNDED"
      ? { order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] } } } } }
      : status === "REFUND_PENDING"
        ? { order: { payments: { some: { status: "REFUND_PENDING" } } } }
        : status && VALID_REGISTRATION_STATUSES.includes(status)
          ? { status: status as never }
          : {}),
    ...(query
      ? {
          OR: [
            { orderId: { contains: query, mode: "insensitive" as const } },
            { athlete: { name: { contains: query, mode: "insensitive" as const } } },
            { athlete: { email: { contains: query, mode: "insensitive" as const } } },
            ...(normalizedCpf
              ? [{ athlete: { athleteProfile: { cpf: { contains: normalizedCpf } } } }]
              : []),
          ],
        }
      : {}),
  };
}
```

- [ ] **Step 4: Adicionar a opção no filtro visual das páginas de inscritos**

Em `app/organizador/eventos/[id]/inscritos/page.tsx` e `app/admin/eventos/[id]/inscritos/page.tsx`, adicionar ao `REGISTRATION_STATUS` (usado para popular o `<select>` de filtro):

```ts
  REFUND_PENDING:  { label: "Cancelado — reembolso pendente", color: BADGE.orange },
```

(logo abaixo da entrada `REFUNDED` já existente em cada um dos dois arquivos).

- [ ] **Step 5: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros — `cancellationReason`/`cancellationRequestedAt` já vêm no resultado do Prisma (`include` traz todos os campos escalares de `Registration`), só faltava declará-los na interface.

- [ ] **Step 6: Verificação manual**

Run: `npm run dev`. Em `/organizador/eventos/[id]/inscritos`, forçar (via seed ou Prisma Studio) uma inscrição `CANCELLED` com `cancellationReason` preenchido e um `Payment.status = "REFUND_PENDING"` associado.
Expected: badge "Cancelado — reembolso pendente" aparece; botão "Ver justificativa" abre o modal com o texto correto; filtro "Cancelado — reembolso pendente" no `<select>` filtra corretamente.

- [ ] **Step 7: Commit**

```bash
git add components/registrations/CancellationReasonModal.tsx components/registrations/RegistrationsTable.tsx lib/organizer/registrations.ts app/organizador/eventos/\[id\]/inscritos/page.tsx app/admin/eventos/\[id\]/inscritos/page.tsx
git commit -m "feat: show cancellation reason and pending-refund status on registrants list"
```

---

### Task 13: Modal de confirmação em Aprovar/Rejeitar cancelamento

**Files:**
- Modify: `components/organizer/CancellationDecisionButtons.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx:187-208`

**Interfaces:**
- Produces: `CancellationDecisionButtons({ registrationId: string; cancellationReason: string | null; endpoint: string })` — usado também pela Task 15 (fila de pendências), com `endpoint` apontando para a rota de admin ou de organizador conforme o contexto.

- [ ] **Step 1: Reescrever `components/organizer/CancellationDecisionButtons.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancellationDecisionButtons({
  registrationId,
  cancellationReason,
  endpoint,
}: {
  registrationId: string;
  cancellationReason: string | null;
  endpoint: string;
}) {
  const [pendingDecision, setPendingDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function confirm() {
    if (!pendingDecision) return;
    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: pendingDecision }),
    });
    setLoading(false);
    if (res.ok) {
      setPendingDecision(null);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao processar a decisão.");
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => setPendingDecision("APPROVE")}
          className="text-xs text-green-600 hover:underline"
        >
          Aprovar
        </button>
        <button
          onClick={() => setPendingDecision("REJECT")}
          className="text-xs text-red-600 hover:underline"
        >
          Rejeitar
        </button>
      </div>

      {pendingDecision && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setPendingDecision(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {pendingDecision === "APPROVE" ? "Confirmar aprovação do cancelamento" : "Confirmar rejeição do cancelamento"}
            </h2>
            <p className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Justificativa do atleta
            </p>
            <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {cancellationReason ?? "Nenhuma justificativa registrada."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDecision(null)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={loading}
                className={`px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50 ${
                  pendingDecision === "APPROVE" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {loading ? "Enviando..." : pendingDecision === "APPROVE" ? "Confirmar aprovação" : "Confirmar rejeição"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Atualizar o call site em `app/organizador/eventos/[id]/inscritos/page.tsx`**

Trocar:

```tsx
                {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
```

por:

```tsx
                {r.status === "CANCELLATION_REQUESTED" && (
                  <CancellationDecisionButtons
                    registrationId={r.id}
                    cancellationReason={r.cancellationReason}
                    endpoint={`/api/organizer/registrations/${r.id}/cancellation-decision`}
                  />
                )}
```

- [ ] **Step 3: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

Run: `npm run dev`. Em `/organizador/eventos/[id]/inscritos`, com uma inscrição `CANCELLATION_REQUESTED` de teste, clicar em "Aprovar".
Expected: abre um modal mostrando a justificativa do atleta e pedindo "Confirmar aprovação" / "Cancelar" — a decisão só é enviada ao clicar em "Confirmar aprovação". O mesmo vale para "Rejeitar".

- [ ] **Step 5: Commit**

```bash
git add components/organizer/CancellationDecisionButtons.tsx app/organizador/eventos/\[id\]/inscritos/page.tsx
git commit -m "feat: require reason review and explicit confirmation before approving/rejecting cancellation"
```

---

### Task 14: Botão de estorno manual/externo

**Files:**
- Create: `components/payment/ManualRefundResolutionButton.tsx`

**Interfaces:**
- Produces: `ManualRefundResolutionButton({ endpoint: string }): JSX.Element` — usado pela Task 15.

- [ ] **Step 1: Criar `components/payment/ManualRefundResolutionButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManualRefundResolutionButton({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function confirm() {
    if (!note.trim()) return;
    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNote: note.trim() }),
    });
    setLoading(false);
    if (res.ok) {
      setOpen(false);
      setNote("");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao registrar o estorno manual.");
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">
        Registrar estorno manual
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Registrar estorno manual</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Use quando o estorno automático falhou e o valor já foi devolvido ao atleta fora da plataforma (ex.:
              PIX manual, transferência).
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva como e quando o estorno foi feito fora da plataforma"
              className="input-field text-sm mt-3"
              rows={3}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={loading || !note.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {loading ? "Registrando..." : "Confirmar estorno manual"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros (o componente ainda não é usado em nenhuma página — isso acontece na Task 15).

- [ ] **Step 3: Commit**

```bash
git add components/payment/ManualRefundResolutionButton.tsx
git commit -m "feat: add manual refund resolution modal button"
```

---

### Task 15: Páginas de cancelamentos e reembolsos pendentes (admin + organizador)

**Files:**
- Create: `components/registrations/PendingCancellationsTable.tsx`
- Create: `components/payment/PendingRefundsTable.tsx`
- Create: `app/organizador/reembolsos-pendentes/page.tsx`
- Create: `app/admin/reembolsos-pendentes/page.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `listPendingCancellations`, `listPendingRefunds` (Task 11); `CancellationDecisionButtons` (Task 13); `CancellationReasonModal` (Task 12); `ManualRefundResolutionButton` (Task 14); `requireOrganizer`/`requireAdmin` (`lib/auth/rbac.ts`, já existentes); `formatCurrency`, `formatDate` (`lib/format`, já existentes).

- [ ] **Step 1: Criar `components/registrations/PendingCancellationsTable.tsx`**

```tsx
import { formatDate } from "@/lib/format";
import CancellationReasonModal from "@/components/registrations/CancellationReasonModal";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
import type { PendingCancellation } from "@/lib/registrations/pending-queue";

export default function PendingCancellationsTable({
  items,
  decisionEndpoint,
}: {
  items: PendingCancellation[];
  decisionEndpoint: (registrationId: string) => string;
}) {
  if (items.length === 0) {
    return <div className="card text-center py-8 text-gray-500">Nenhuma solicitação de cancelamento pendente.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Evento</th>
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Solicitado em</th>
            <th className="pb-2 pr-3">Justificativa</th>
            <th className="pb-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">{item.event.title}</td>
              <td className="py-2 pr-3">
                <p className="font-medium">{item.athlete.name}</p>
                <p className="text-gray-500">{item.athlete.email}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700">
                {item.cancellationRequestedAt ? formatDate(item.cancellationRequestedAt, "dd/MM/yy HH:mm") : "—"}
              </td>
              <td className="py-2 pr-3">
                <CancellationReasonModal
                  athleteName={item.athlete.name}
                  reason={item.cancellationReason ?? ""}
                  requestedAt={item.cancellationRequestedAt}
                />
              </td>
              <td className="py-2">
                <CancellationDecisionButtons
                  registrationId={item.id}
                  cancellationReason={item.cancellationReason}
                  endpoint={decisionEndpoint(item.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Criar `components/payment/PendingRefundsTable.tsx`**

```tsx
import { formatCurrency, formatDate } from "@/lib/format";
import ManualRefundResolutionButton from "@/components/payment/ManualRefundResolutionButton";
import type { PendingRefund } from "@/lib/registrations/pending-queue";

export default function PendingRefundsTable({
  items,
  resolveEndpoint,
}: {
  items: PendingRefund[];
  resolveEndpoint: (paymentId: string) => string;
}) {
  if (items.length === 0) {
    return <div className="card text-center py-8 text-gray-500">Nenhum reembolso pendente.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Evento</th>
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Valor</th>
            <th className="pb-2 pr-3">Motivo da falha</th>
            <th className="pb-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">{item.event.title}</td>
              <td className="py-2 pr-3">
                <p className="font-medium">{item.athlete.name}</p>
                <p className="text-gray-500">{item.athlete.email}</p>
              </td>
              <td className="py-2 pr-3">{formatCurrency(item.amount)}</td>
              <td className="py-2 pr-3 text-gray-700">
                <p>{item.latestFailedRefund?.failureReason ?? "—"}</p>
                {item.latestFailedRefund && (
                  <p className="text-gray-400">{formatDate(item.latestFailedRefund.createdAt, "dd/MM/yy HH:mm")}</p>
                )}
              </td>
              <td className="py-2">
                <ManualRefundResolutionButton endpoint={resolveEndpoint(item.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Criar `app/organizador/reembolsos-pendentes/page.tsx`**

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";
import PendingCancellationsTable from "@/components/registrations/PendingCancellationsTable";
import PendingRefundsTable from "@/components/payment/PendingRefundsTable";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cancelamentos e reembolsos pendentes" };
export const dynamic = "force-dynamic";

export default async function OrganizerReembolsosPendentesPage() {
  const session = await requireOrganizer();
  const [cancellations, refunds] = await Promise.all([
    listPendingCancellations(session.user.id),
    listPendingRefunds(session.user.id),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Cancelamentos e reembolsos pendentes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Solicitações de cancelamento aguardando sua aprovação e reembolsos que precisam de resolução manual.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Solicitações de cancelamento</h2>
        <PendingCancellationsTable
          items={cancellations}
          decisionEndpoint={(id) => `/api/organizer/registrations/${id}/cancellation-decision`}
        />
      </div>

      <div>
        <h2 className="font-semibold mb-2">Reembolsos pendentes</h2>
        <PendingRefundsTable
          items={refunds}
          resolveEndpoint={(paymentId) => `/api/organizer/refunds/${paymentId}/manual-resolve`}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar `app/admin/reembolsos-pendentes/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";
import PendingCancellationsTable from "@/components/registrations/PendingCancellationsTable";
import PendingRefundsTable from "@/components/payment/PendingRefundsTable";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cancelamentos e reembolsos pendentes — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminReembolsosPendentesPage() {
  await requireAdmin();
  const [cancellations, refunds] = await Promise.all([listPendingCancellations(), listPendingRefunds()]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Cancelamentos e reembolsos pendentes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Solicitações de cancelamento e reembolsos pendentes de todos os eventos da plataforma.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Solicitações de cancelamento</h2>
        <PendingCancellationsTable
          items={cancellations}
          decisionEndpoint={(id) => `/api/admin/registrations/${id}/cancellation-decision`}
        />
      </div>

      <div>
        <h2 className="font-semibold mb-2">Reembolsos pendentes</h2>
        <PendingRefundsTable
          items={refunds}
          resolveEndpoint={(paymentId) => `/api/admin/refunds/${paymentId}/manual-resolve`}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Adicionar os links de navegação**

Em `components/organizer/OrganizerNav.tsx`, adicionar (nos dois blocos onde `pedidos-vencidos` aparece — menu desktop e mobile, linhas ~20 e ~45), logo após o link de "Pedidos vencidos":

```tsx
            <Link href="/organizador/reembolsos-pendentes" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Cancelamentos pendentes</Link>
```

Em `components/admin/AdminNav.tsx`, adicionar (linha ~16), logo após o link de "Pedidos vencidos":

```tsx
          <Link href="/admin/reembolsos-pendentes" className="hover:text-gray-300">Cancelamentos pendentes</Link>
```

- [ ] **Step 6: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Verificação manual**

Run: `npm run dev`. Acessar `/organizador/reembolsos-pendentes` logado como organizador com pelo menos uma inscrição `CANCELLATION_REQUESTED` e um `Payment REFUND_PENDING` de teste; repetir em `/admin/reembolsos-pendentes` logado como admin.
Expected: as duas seções listam os itens esperados, escopados corretamente (organizador só vê os próprios eventos, admin vê todos); os botões "Aprovar"/"Rejeitar" e "Registrar estorno manual" funcionam ponta a ponta.

- [ ] **Step 8: Commit**

```bash
git add components/registrations/PendingCancellationsTable.tsx components/payment/PendingRefundsTable.tsx app/organizador/reembolsos-pendentes app/admin/reembolsos-pendentes components/organizer/OrganizerNav.tsx components/admin/AdminNav.tsx
git commit -m "feat: add pending cancellations/refunds pages for organizer and admin"
```

---

### Task 16: Verificação final

**Files:** nenhum (apenas validação)

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `npm test`
Expected: todos os testes passam, incluindo os novos arquivos criados nas Tasks 1–11.

- [ ] **Step 2: Rodar o lint**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Rodar o type-check completo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Roteiro manual ponta a ponta**

Run: `npm run dev`. Com um evento de teste com `cancellationRequiresApproval = true`:
1. Como atleta, cancelar uma inscrição `CONFIRMED` sem motivo → deve bloquear pedindo justificativa.
2. Cancelar com motivo → deve virar `CANCELLATION_REQUESTED` e (se e-mail/WhatsApp estiverem habilitados em `/admin/alertas` e configurados) o admin/organizador deve receber o aviso.
3. Como organizador, em `/organizador/reembolsos-pendentes`, clicar "Aprovar" → modal mostra a justificativa → confirmar → inscrição vira `CANCELLED`; se o gateway sandbox estornar com sucesso, o pagamento vira `REFUNDED`; se falhar, vira `REFUND_PENDING` e o item aparece na seção "Reembolsos pendentes".
4. Em "Reembolsos pendentes", clicar "Registrar estorno manual", preencher a nota e confirmar → pagamento vira `REFUNDED`.
5. Em `/organizador/eventos/[id]/inscritos`, conferir que a inscrição mostra o badge correto e o botão "Ver justificativa" com o texto certo.

Com um evento de teste com `cancellationRequiresApproval = false` (padrão):
6. Cancelar uma inscrição sem motivo → deve bloquear pedindo justificativa.
7. Cancelar com motivo → inscrição cancela imediatamente, sem aprovação, sem notificação, sem tentativa de estorno (comportamento preservado).

- [ ] **Step 5: Commit final (se o roteiro manual revelar ajustes)**

Se qualquer passo do roteiro manual expuser um bug, corrija, adicione/ajuste o teste automatizado correspondente na task de origem, e commit separadamente com uma mensagem descrevendo o ajuste.
