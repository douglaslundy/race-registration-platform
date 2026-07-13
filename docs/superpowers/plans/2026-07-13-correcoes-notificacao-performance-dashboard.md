# Notificação órfã + índices + tooltip + filtro nos KPIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins/organizers resend a "invite to re-register" notification for orders cancelled
with zero payment (today the button doesn't even appear); add missing `createdAt` indexes on the
tables behind the slowest recurring queries; give each dashboard chart a real tooltip label instead
of the generic "value"; move both dashboards' filters above the KPI cards and make those cards
respect the selected date range (and, for registration counts, the selected event).

**Architecture:** `lib/alerts/payment-error.ts` gets a shared internal helper so its existing
`Payment`-keyed notifier and a new `Order`-keyed one share the same email/WhatsApp/dedupe logic.
Both `resend-payment-notification` routes (admin, organizer) gain a second branch for the
no-payment case; both inscritos list pages gain a matching UI condition. `components/ui/LineChart.tsx`
gains a `name` prop threaded straight to Recharts' `<Line name={...}>`. Both dashboard pages get
their KPI queries date/event-scoped and their filter form moved above the KPI grids.

**Tech Stack:** Next.js App Router, Prisma, Vitest.

## Global Constraints

- `notifyPaymentError`'s external behavior (signature, messages, dedupe keys, `AlertLog` shape)
  must not change — the refactor is internal only.
- The new order-based notifier reuses the SAME `PAYMENT_ERROR` alert-type settings toggle
  (`getPaymentErrorAlertSettings`) — it's the same class of alert, just a different technical
  trigger, not a new alert type.
- No new API route, no new button component — the existing endpoint and
  `ResendPaymentNotificationButton` are reused for the orphan case too.
- KPI cards: date range scoping replaces the all-time total (not additive) — `totalUsers`/
  `totalEvents`/`totalOrders`/`revenue` get `createdAt` scoping only; the 3 registration-status
  cards (both dashboards) get `createdAt` AND `eventId` (when selected) scoping, matching the
  registrations chart's existing `eventId` behavior. `pendingEvents` (the "aguardando aprovação"
  banner count) is NOT scoped — it's a current-state action item, not a historical metric.
- Card labels that change semantics get updated copy so returning users aren't confused by the
  same label suddenly meaning something different.
- Migration is additive only (new indexes) — no data change, no risk.

---

### Task 1: Add `createdAt` indexes

**Files:**
- Modify: `prisma/schema.prisma` (`AuditLog`, `User`, `Registration`, `Order` models)
- Create: `prisma/migrations/20260713000000_add_created_at_indexes/migration.sql`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks in this plan — purely a standalone performance fix.

- [ ] **Step 1: Add the four `@@index([createdAt])` lines**

In `prisma/schema.prisma`, `AuditLog` model (currently ending):

```prisma
  @@index([entityType, entityId])
  @@index([userId])
  @@map("audit_logs")
}
```

becomes:

```prisma
  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

`User` model (currently ending):

```prisma
  @@map("users")
}
```

becomes:

```prisma
  @@index([createdAt])
  @@map("users")
}
```

`Registration` model (currently ending):

```prisma
  @@index([eventId, status])
  @@index([athleteUserId])
  @@map("registrations")
}
```

becomes:

```prisma
  @@index([eventId, status])
  @@index([athleteUserId])
  @@index([createdAt])
  @@map("registrations")
}
```

`Order` model (currently ending):

```prisma
  @@index([buyerUserId])
  @@index([eventId, status])
  @@index([payoutId])
  @@map("orders")
}
```

becomes:

```prisma
  @@index([buyerUserId])
  @@index([eventId, status])
  @@index([payoutId])
  @@index([createdAt])
  @@map("orders")
}
```

- [ ] **Step 2: Hand-write the migration file**

Create `prisma/migrations/20260713000000_add_created_at_indexes/migration.sql`:

```sql
-- Índices ausentes em createdAt: usados por Atividade recente/auditoria (audit_logs) e pelos
-- gráficos de dashboard (users/registrations/orders), sem nenhum índice de suporte até aqui
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "registrations_createdAt_idx" ON "registrations"("createdAt");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
```

- [ ] **Step 3: Regenerate the Prisma client (schema-only, no DB needed)**

Run: `npx prisma generate`

Expected: succeeds, prints "Generated Prisma Client". No database connection needed or used.

- [ ] **Step 4: Confirm the rest of the codebase still type-checks**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260713000000_add_created_at_indexes
git commit -m "perf: add missing createdAt indexes on AuditLog, User, Registration, Order"
```

---

### Task 2: `notifyOrderCancelledWithoutPayment` in `lib/alerts/payment-error.ts`

**Files:**
- Modify: `lib/alerts/payment-error.ts`
- Modify: `tests/alert-payment-error.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `notifyOrderCancelledWithoutPayment(orderId: string, options?: {bypassDedupe?: boolean}): Promise<void>` — Task 3's routes call this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/alert-payment-error.test.ts` (reuses the same mocks already declared at the top
of the file — no new `vi.mock` needed; add the new import name to the existing import line):

Change:

```ts
import { notifyPaymentError } from "@/lib/alerts/payment-error";
```

to:

```ts
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";
```

Append a new `describe` block at the end of the file, after the closing `});` of
`describe("notifyPaymentError", ...)`:

```ts
const orderFixture = {
  event: { title: "Corrida Teste", slug: "corrida-teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("notifyOrderCancelledWithoutPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pedido não é encontrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(null);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e reivindica o alerta com entityType Order", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Order", "order-1", "EMAIL");
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", eventSlug: "corrida-teste" }),
    );
  });

  it("envia WhatsApp quando o atleta tem telefone cadastrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Order", "order-1", "WHATSAPP");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      expect.stringContaining("Corrida Teste"),
    );
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      buyer: { ...orderFixture.buyer, athleteProfile: null },
    });

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("libera a reivindicação quando o envio de e-mail falha", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(unclaimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "order-1", "EMAIL");
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyOrderCancelledWithoutPayment("order-1")).resolves.toBeUndefined();
  });

  it("com bypassDedupe: envia mesmo que claimAlert diria não (nem chama claimAlert)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1", { bypassDedupe: true });

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "atleta@example.com" }));
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/alert-payment-error.test.ts`

Expected: FAIL — `notifyOrderCancelledWithoutPayment` doesn't exist yet (import error), and the
existing `notifyPaymentError` tests should still pass unchanged at this point (nothing implemented
yet, but nothing broken either — this step is really "confirm the new tests fail to compile/run").

- [ ] **Step 3: Refactor `lib/alerts/payment-error.ts`**

Replace the full content of `lib/alerts/payment-error.ts` with:

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

interface CancellationNotificationTarget {
  entityId: string;
  entityType: "Payment" | "Order";
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
  event: { title: string; slug: string };
  bypassDedupe?: boolean;
}

async function sendCancellationInviteNotification(params: CancellationNotificationTarget): Promise<void> {
  const settings = await getPaymentErrorAlertSettings();
  if (!settings.emailEnabled && !settings.whatsappEnabled) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const eventUrl = `${baseUrl}/eventos/${params.event.slug}`;

  if (settings.emailEnabled) {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "EMAIL");
      if (claimed) {
        try {
          await sendPaymentErrorEmail({
            to: params.buyer.email,
            name: params.buyer.name,
            eventTitle: params.event.title,
            eventSlug: params.event.slug,
          });
        } catch (err) {
          if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "EMAIL");
          throw err;
        }
      }
    }
  }

  if (settings.whatsappEnabled && params.buyer.athleteProfile?.phone) {
    const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "WHATSAPP");
    if (claimed) {
      try {
        await sendWhatsAppMessage(
          params.buyer.athleteProfile.phone,
          `Sua inscrição em "${params.event.title}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${eventUrl}`,
        );
      } catch (err) {
        if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "WHATSAPP");
        throw err;
      }
    }
  }
}

export async function notifyPaymentError(
  paymentId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            event: { select: { title: true, slug: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;

    await sendCancellationInviteNotification({
      entityId: paymentId,
      entityType: "Payment",
      buyer: payment.order.buyer,
      event: payment.order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}

export async function notifyOrderCancelledWithoutPayment(
  orderId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        event: { select: { title: true, slug: true } },
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      },
    });

    if (!order) return;

    await sendCancellationInviteNotification({
      entityId: orderId,
      entityType: "Order",
      buyer: order.buyer,
      event: order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyOrderCancelledWithoutPayment] failed:", err);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/alert-payment-error.test.ts`

Expected: PASS, all tests — the pre-existing `notifyPaymentError` tests (unchanged assertions)
plus the new `notifyOrderCancelledWithoutPayment` tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/alerts/payment-error.ts tests/alert-payment-error.test.ts
git commit -m "feat: add order-based cancellation-invite notification for orders with no payment"
```

---

### Task 3: Wire into both routes + fix UI gating on both inscritos pages

**Files:**
- Modify: `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`
- Modify: `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`
- Modify: `tests/admin-resend-payment-notification-route.test.ts`
- Modify: `tests/organizer-resend-payment-notification-route.test.ts`
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `notifyOrderCancelledWithoutPayment` (Task 2).
- Produces: nothing consumed by later tasks — this is the last task closing out item 1.

- [ ] **Step 1: Write the failing tests for the admin route**

In `tests/admin-resend-payment-notification-route.test.ts`, change:

```ts
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/admin/registrations/[id]/resend-payment-notification/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
```

to:

```ts
vi.mock("@/lib/alerts/payment-error", () => ({
  notifyPaymentError: vi.fn(),
  notifyOrderCancelledWithoutPayment: vi.fn(),
}));

import { POST } from "@/app/api/admin/registrations/[id]/resend-payment-notification/route";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";
```

Then add two new tests at the end of the existing `describe(...)` block, right before its closing
`});` (matching the file's existing `makeRequest()`/inline `{ params: Promise.resolve({ id: "reg-1" }) }` convention exactly — no `ctx` const exists in this file):

```ts
  it("chama notifyOrderCancelledWithoutPayment quando não há payment e a inscrição está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "CANCELLED",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(notifyOrderCancelledWithoutPayment).toHaveBeenCalledWith("order-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: "order-1",
      }),
    });
  });

  it("retorna 400 quando não há payment e a inscrição não está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(notifyOrderCancelledWithoutPayment).not.toHaveBeenCalled();
  });
```

The existing test `"retorna 400 quando não há pagamento expirado/cancelado para essa inscrição"`
(fixture `{ id: "reg-1", order: { payments: [] } }`, no `status` field) keeps passing unchanged —
`registration.status` is `undefined` there, which isn't `"CANCELLED"`, so it still falls through to
the same 400 response as before.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`

Expected: FAIL — the route doesn't have the new branch yet, so a `CANCELLED`-status/no-payment
registration falls through to the existing 400 response instead of calling the new notifier.

- [ ] **Step 3: Update the admin route**

Replace `app/api/admin/registrations/[id]/resend-payment-notification/route.ts` in full:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id },
    select: {
      status: true,
      orderId: true,
      order: {
        select: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];

  if (payment) {
    await notifyPaymentError(payment.id, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  if (registration.status === "CANCELLED") {
    await notifyOrderCancelledWithoutPayment(registration.orderId, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: registration.orderId,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
}
```

- [ ] **Step 4: Run the admin test and confirm it passes**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`

Expected: PASS, all tests (existing + new).

- [ ] **Step 5: Repeat steps 1-4 for the organizer route**

In `tests/organizer-resend-payment-notification-route.test.ts`, apply the identical mock-factory
change as Step 1 (add `notifyOrderCancelledWithoutPayment: vi.fn()` to the `vi.mock(...)` factory
and import it), then add these two tests at the end of the existing `describe(...)` block, right
before its closing `});`:

```ts
  it("chama notifyOrderCancelledWithoutPayment quando não há payment e a inscrição está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "CANCELLED",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(notifyOrderCancelledWithoutPayment).toHaveBeenCalledWith("order-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: "order-1",
      }),
    });
  });

  it("retorna 400 quando não há payment e a inscrição não está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(notifyOrderCancelledWithoutPayment).not.toHaveBeenCalled();
  });
```

The existing 400 test in this file keeps passing unchanged for the same reason as the admin file's.

Then replace
`app/api/organizer/registrations/[id]/resend-payment-notification/route.ts` in full:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: {
      status: true,
      orderId: true,
      order: {
        select: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];

  if (payment) {
    await notifyPaymentError(payment.id, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  if (registration.status === "CANCELLED") {
    await notifyOrderCancelledWithoutPayment(registration.orderId, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: registration.orderId,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
}
```

Run: `npx vitest run tests/organizer-resend-payment-notification-route.test.ts`

Expected: PASS, all tests.

**Note on the route's `select` shape:** both routes changed `include` → `select` for the
`registration` query and added `status`/`orderId` to what's selected (the original only selected
`order.payments`, implicitly via `include`) — this is a minimal, compatible widening, not a
behavior change to the payment-path branch.

- [ ] **Step 6: Fix the UI gating on the admin inscritos page**

In `app/admin/eventos/[id]/inscritos/page.tsx`, change:

```tsx
                {(payment?.status === "EXPIRED" || payment?.status === "CANCELLED") && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/admin/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
```

to:

```tsx
                {((payment?.status === "EXPIRED" || payment?.status === "CANCELLED") || (r.status === "CANCELLED" && !payment)) && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/admin/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
```

- [ ] **Step 7: Fix the UI gating on the organizer inscritos page**

In `app/organizador/eventos/[id]/inscritos/page.tsx`, change:

```tsx
                {(payment?.status === "EXPIRED" || payment?.status === "CANCELLED") && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/organizer/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
```

to:

```tsx
                {((payment?.status === "EXPIRED" || payment?.status === "CANCELLED") || (r.status === "CANCELLED" && !payment)) && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/organizer/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
```

(Read both files fresh first to confirm the exact current endpoint URL/prop text before/after —
they should match what's shown here since no other task touches these lines, but verify rather
than assume.)

- [ ] **Step 8: Run the full suite and type-check**

Run: `npx vitest run` and `npx tsc --noEmit`

Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/registrations/[id]/resend-payment-notification/route.ts
git add app/api/organizer/registrations/[id]/resend-payment-notification/route.ts
git add tests/admin-resend-payment-notification-route.test.ts tests/organizer-resend-payment-notification-route.test.ts
git add app/admin/eventos/[id]/inscritos/page.tsx "app/organizador/eventos/[id]/inscritos/page.tsx"
git commit -m "fix: show and support the resend-notification button for orphan cancelled orders"
```

---

### Task 4: Chart tooltip labels + KPI cards respect the dashboard filter

**Files:**
- Modify: `components/ui/LineChart.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `app/organizador/page.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add a `name` prop to `LineChart`**

In `components/ui/LineChart.tsx`, change:

```tsx
export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
```

to:

```tsx
export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
  name,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
  name?: string;
}) {
```

And change:

```tsx
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
```

to:

```tsx
        <Line type="monotone" dataKey="value" name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
```

- [ ] **Step 2: Pass `name` at every call site**

In `app/admin/page.tsx`, change the three `<LineChart .../>` calls:

```tsx
          <LineChart data={signupsData} color="#7c3aed" />
```
→
```tsx
          <LineChart data={signupsData} color="#7c3aed" name="Novos cadastros" />
```

```tsx
          <LineChart data={registrationsData} color="#0ea5e9" />
```
→
```tsx
          <LineChart data={registrationsData} color="#0ea5e9" name="Inscrições" />
```

```tsx
          <LineChart data={couponUsageData} color="#f59e0b" />
```
→
```tsx
          <LineChart data={couponUsageData} color="#f59e0b" name="Cupons utilizados" />
```

In `app/organizador/page.tsx`, change the two `<LineChart .../>` calls the same way:

```tsx
          <LineChart data={registrationsData} color="#0ea5e9" />
```
→
```tsx
          <LineChart data={registrationsData} color="#0ea5e9" name="Inscrições" />
```

```tsx
          <LineChart data={couponUsageData} color="#f59e0b" />
```
→
```tsx
          <LineChart data={couponUsageData} color="#f59e0b" name="Cupons utilizados" />
```

- [ ] **Step 3: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Rewrite `app/admin/page.tsx`'s body — scope the KPIs, move the filter up**

Replace the full body of the `AdminDashboard` function (from the first `Promise.all` through the
end of the returned JSX's KPI/banner/filter/chart section — i.e. everything between the `from`/`to`
computation and the "Atividade recente" card) with:

```tsx
  const [totalUsers, totalEvents, totalOrders, pendingEvents, recentAuditLogs, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, revenue] = await Promise.all([
    db.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.order.count({ where: { status: "PAID", createdAt: { gte: from, lte: to } } }),
    db.event.count({ where: { status: "UNDER_REVIEW" } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    db.registration.count({ where: { status: "CONFIRMED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { status: "PENDING_PAYMENT", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { status: "CANCELLED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", createdAt: { gte: from, lte: to } } }),
  ]);

  const [signupsData, registrationsData, couponUsageData, events] = await Promise.all([
    getDailySignups(from, to),
    getDailyRegistrations(from, to, { eventId: eventId || undefined }),
    getDailyCouponUsage(from, to, {}),
    db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600">De</label>
          <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
          <label className="text-gray-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600">Evento (inscrições)</label>
          <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
            <option value="">Todos os eventos</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{totalUsers}</p>
          <p className="text-gray-600 text-sm mt-1">Novos usuários</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{totalEvents}</p>
          <p className="text-gray-600 text-sm mt-1">Novos eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalOrders}</p>
          <p className="text-gray-600 text-sm mt-1">Pedidos pagos no período</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-purple-600">{formatCurrency(revenue._sum.amount ?? 0)}</p>
          <p className="text-gray-600 text-sm mt-1">Receita no período</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmedRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições efetivadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições canceladas</p>
        </div>
      </div>

      {pendingEvents > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-yellow-800 font-medium">
            {pendingEvents} evento{pendingEvents > 1 ? "s" : ""} aguardando aprovação
          </p>
          <Link href="/admin/eventos?status=UNDER_REVIEW" className="btn-primary text-sm">
            Revisar
          </Link>
        </div>
      )}

      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
          <LineChart data={signupsData} color="#7c3aed" name="Novos cadastros" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" name="Inscrições" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" name="Cupons utilizados" />
        </div>
      </div>
```

(This block replaces everything from the current `const [totalUsers, ...] = await Promise.all([`
line through the closing `</div>` of the current chart-stack `<div className="space-y-6">` —
i.e. every KPI/filter/chart section. The `<h1>`, the trailing "Atividade recente" card, and
everything before/after this block are unchanged. Read the file fresh first to confirm the exact
current boundaries before replacing — Task 2's rename and Tasks 3-4 of the prior plan already
landed, so the "before" content should look exactly like what's shown in this task's context, but
verify rather than assume.)

- [ ] **Step 5: Rewrite `app/organizador/page.tsx`'s body — same treatment**

Replace the full body of the `OrganizerDashboard` function from the KPI `Promise.all` through the
end of the chart-stack `<div>` (i.e. everything between the `from`/`to` computation and the "Meus
Eventos" card) with:

```tsx
  const [eventCount, totalRegistrations, revenueAgg, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, statusGroups] = await Promise.all([
    db.event.count({ where: { organizerId: organizer.id, createdAt: { gte: from, lte: to } } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: "PAID", event: { organizerId: organizer.id }, createdAt: { gte: from, lte: to } },
    }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CONFIRMED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "PENDING_PAYMENT", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CANCELLED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.groupBy({
      by: ["eventId", "status"],
      where: { event: { organizerId: organizer.id } },
      _count: { id: true },
    }),
  ]);
  const totalRevenue = revenueAgg._sum.totalAmount ?? 0;

  const statusCountsByEvent = new Map<string, { status: string; count: number }[]>();
  for (const g of statusGroups) {
    const arr = statusCountsByEvent.get(g.eventId) ?? [];
    arr.push({ status: g.status, count: g._count.id });
    statusCountsByEvent.set(g.eventId, arr);
  }

  const [registrationsData, couponUsageData, chartEvents] = await Promise.all([
    getDailyRegistrations(from, to, { organizerId: organizer.id, eventId: eventId || undefined }),
    getDailyCouponUsage(from, to, { organizerId: organizer.id }),
    db.event.findMany({ where: { organizerId: organizer.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/organizador/eventos/novo" className="btn-primary">+ Novo Evento</Link>
      </div>

      <form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600">De</label>
          <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
          <label className="text-gray-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600">Evento (inscrições)</label>
          <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
            <option value="">Todos os eventos</option>
            {chartEvents.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{eventCount}</p>
          <p className="text-gray-600 mt-1">Novos eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalRegistrations}</p>
          <p className="text-gray-600 mt-1">Inscrições no período</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
          <p className="text-gray-600 mt-1">Receita no período</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmedRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições efetivadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições canceladas</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" name="Inscrições" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" name="Cupons utilizados" />
        </div>
      </div>
```

(This block replaces everything from the current `const [eventCount, ...] = await Promise.all([`
line through the closing `</div>` of the chart-stack — the `organizer` fetch/no-profile guard
before it, and the "Meus Eventos" table after it, are unchanged. Read the file fresh first to
confirm exact current boundaries before replacing.)

- [ ] **Step 6: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`

Expected: all tests pass (no dedicated test for either page — matches this project's established
convention).

- [ ] **Step 8: Manual verification note**

Neither the chart tooltip labels nor the KPI/filter reorder can be visually verified from this
environment (no DB access to render either dashboard with real data). Note this explicitly in the
task report.

- [ ] **Step 9: Commit**

```bash
git add components/ui/LineChart.tsx app/admin/page.tsx app/organizador/page.tsx
git commit -m "feat: custom chart tooltip labels, move dashboard filters above KPIs, scope KPIs to the filtered period"
```
