# Página de carrinhos abandonados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin and organizer a page listing every `PENDING` order (abandoned cart) with a
per-row "send alert now" action and a "send to all" bulk action, on top of the existing automated
cron alert.

**Architecture:** Extract the per-order send logic already in `checkAbandonedCarts` into a reusable
`sendAbandonedCartAlert` function with a `bypassDedupe` escape hatch (same pattern already used by
`notifyPaymentError`). Add a shared query helper for listing pending orders (with/without organizer
scope). Add two new API routes (admin, organizer) that call the extracted function manually. Add two
new pages reusing shared button components.

**Tech Stack:** Next.js App Router (server components + route handlers), Prisma, Vitest, Tailwind.
No new dependencies.

## Global Constraints

- Never use `alert()`/`confirm()`/`prompt()` — use `ConfirmModal`/`ErrorModal` (see CLAUDE.md).
- API routes in this codebase authenticate with `auth()` directly + manual role check (not the
  `requireAdmin`/`requireOrganizer` page helpers, which redirect instead of returning JSON).
- Every admin/organizer action that mutates or sends something on someone's behalf writes an
  `AuditLog` row.
- Follow existing formatting/lint conventions (no semicolon changes, double quotes, existing Tailwind
  class patterns) — this repo has no forced linter run in CI for this change, but `npm run lint`
  should stay clean.

---

### Task 1: Extract `sendAbandonedCartAlert` with a `bypassDedupe` option

**Files:**
- Modify: `lib/alerts/abandoned-cart.ts`
- Test: `tests/alert-abandoned-cart.test.ts`

**Interfaces:**
- Produces: `sendAbandonedCartAlert(order: AbandonedOrder, settings: { emailEnabled: boolean; whatsappEnabled: boolean }, options?: { bypassDedupe?: boolean }): Promise<{ sent: boolean }>` — used by Task 3 and Task 4.
- `checkAbandonedCarts()` keeps its existing signature and behavior (all current tests must keep
  passing unmodified).

- [ ] **Step 1: Write the failing test for bypassDedupe behavior**

Add to `tests/alert-abandoned-cart.test.ts`, after the existing `describe("checkAbandonedCarts", ...)`
block (same file, new `describe` block, reusing the mocks and `orderFixture` already declared at the
top of the file):

```ts
describe("sendAbandonedCartAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("com bypassDedupe, envia e-mail sem chamar claimAlert", async () => {
    const result = await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: true, whatsappEnabled: false },
      { bypassDedupe: true },
    );

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(result).toEqual({ sent: true });
  });

  it("com bypassDedupe, envia WhatsApp mesmo se um alerta automático já tiver sido enviado antes", async () => {
    const result = await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: false, whatsappEnabled: true },
      { bypassDedupe: true },
    );

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).toHaveBeenCalled();
    expect(result).toEqual({ sent: true });
  });

  it("sem bypassDedupe, continua respeitando claimAlert (comportamento automático inalterado)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(false);

    const result = await sendAbandonedCartAlert(orderFixture, { emailEnabled: true, whatsappEnabled: false });

    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false });
  });

  it("com bypassDedupe, não chama unclaimAlert quando o envio falha (não há claim pra desfazer)", async () => {
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(
      sendAbandonedCartAlert(orderFixture, { emailEnabled: true, whatsappEnabled: false }, { bypassDedupe: true }),
    ).rejects.toThrow("SMTP down");
    expect(unclaimAlert).not.toHaveBeenCalled();
  });
});
```

Also update the import line at the top of the file:

```ts
import { checkAbandonedCarts, sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: FAIL — `sendAbandonedCartAlert is not a function` (or similar) for the 4 new tests; the
pre-existing `checkAbandonedCarts` tests still pass.

- [ ] **Step 3: Implement the extraction in `lib/alerts/abandoned-cart.ts`**

Replace the full file contents with:

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export interface AbandonedOrder {
  id: string;
  buyerUserId: string;
  event: { title: string };
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
}

export async function sendAbandonedCartAlert(
  order: AbandonedOrder,
  settings: { emailEnabled: boolean; whatsappEnabled: boolean },
  options?: { bypassDedupe?: boolean },
): Promise<{ sent: boolean }> {
  const bypassDedupe = options?.bypassDedupe ?? false;

  await db.auditLog.create({
    data: {
      userId: order.buyerUserId,
      action: "CART_ABANDONED",
      entityType: "Order",
      entityId: order.id,
      metadata: { eventTitle: order.event.title },
    },
  });

  let sentSomething = false;

  if (settings.emailEnabled) {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg) && (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL")))) {
      try {
        await sendAbandonedCartEmail({
          to: order.buyer.email,
          name: order.buyer.name,
          eventTitle: order.event.title,
          orderId: order.id,
        });
        sentSomething = true;
      } catch (err) {
        if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
        throw err;
      }
    }
  }

  if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
    if (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP"))) {
      try {
        await sendWhatsAppMessage(
          order.buyer.athleteProfile.phone,
          `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
        );
        sentSomething = true;
      } catch (err) {
        if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
        throw err;
      }
    }
  }

  return { sent: sentSomething };
}

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      buyerUserId: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      const { sent } = await sendAbandonedCartAlert(order, settings);
      if (sent) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: PASS — all pre-existing `checkAbandonedCarts` tests plus the 4 new `sendAbandonedCartAlert` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/abandoned-cart.ts tests/alert-abandoned-cart.test.ts
git commit -m "refactor: extract sendAbandonedCartAlert with bypassDedupe option"
```

---

### Task 2: Query helper for listing abandoned carts

**Files:**
- Create: `lib/alerts/abandoned-cart-query.ts`
- Test: `tests/abandoned-cart-query.test.ts`

**Interfaces:**
- Consumes: `parseDateInput` from `lib/admin/audit.ts` (`export function parseDateInput(dateValue?: string, endOfDay = false): Date | undefined`).
- Produces:
  - `buildAbandonedCartWhere(params: Pick<AbandonedCartSearchParams, "q"|"event"|"dateFrom"|"dateTo">, scope?: { organizerUserId: string }): Prisma.OrderWhereInput` — used by Task 3, 4, 5, 6.
  - `buildAbandonedCartOrderBy(sort: string, dir: string): { orderBy: Prisma.OrderOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc"|"desc" }` — used by Task 5, 6.
  - `listAbandonedCarts(where, orderBy, skip, take): Promise<{ rows: AbandonedCartRow[]; total: number }>` — used by Task 5, 6.
  - `AbandonedCartRow` type: `{ id: string; createdAt: Date; subtotalAmount: number; eventTitle: string; buyerName: string; buyerEmail: string; hasPhone: boolean; lastAlertSentAt: Date | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/abandoned-cart-query.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

const dbMock = db as any;

import { buildAbandonedCartWhere, buildAbandonedCartOrderBy, listAbandonedCarts } from "@/lib/alerts/abandoned-cart-query";

describe("buildAbandonedCartWhere", () => {
  it("sempre filtra status PENDING", () => {
    const where = buildAbandonedCartWhere({});
    expect(where).toEqual({ AND: [{ status: "PENDING" }] });
  });

  it("adiciona escopo de organizador quando informado", () => {
    const where = buildAbandonedCartWhere({}, { organizerUserId: "org-user-1" });
    expect(where).toEqual({
      AND: [{ status: "PENDING" }, { event: { organizer: { userId: "org-user-1" } } }],
    });
  });

  it("filtra por busca (q) em comprador ou evento", () => {
    const where = buildAbandonedCartWhere({ q: "maria" });
    expect(where).toEqual({
      AND: [
        { status: "PENDING" },
        {
          OR: [
            { buyer: { name: { contains: "maria", mode: "insensitive" } } },
            { buyer: { email: { contains: "maria", mode: "insensitive" } } },
            { event: { title: { contains: "maria", mode: "insensitive" } } },
          ],
        },
      ],
    });
  });
});

describe("buildAbandonedCartOrderBy", () => {
  it("ordena por createdAt desc por padrão", () => {
    expect(buildAbandonedCartOrderBy("", "")).toEqual({
      orderBy: [{ createdAt: "desc" }],
      normalizedSort: "createdAt",
      normalizedDir: "desc",
    });
  });

  it("ordena por valor (amount) quando pedido", () => {
    expect(buildAbandonedCartOrderBy("amount", "asc")).toEqual({
      orderBy: [{ subtotalAmount: "asc" }, { createdAt: "desc" }],
      normalizedSort: "amount",
      normalizedDir: "asc",
    });
  });
});

describe("listAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("junta o último AlertLog de cada pedido nas linhas retornadas", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        subtotalAmount: 5000,
        event: { title: "Corrida X" },
        buyer: { name: "Maria", email: "maria@example.com", athleteProfile: { phone: "5511999999999" } },
      },
    ]);
    dbMock.order.count.mockResolvedValueOnce(1);
    dbMock.alertLog.findMany.mockResolvedValueOnce([
      { entityId: "order-1", sentAt: new Date("2026-07-02T00:00:00Z") },
    ]);

    const result = await listAbandonedCarts({ AND: [{ status: "PENDING" }] }, [{ createdAt: "desc" }], 0, 20);

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      {
        id: "order-1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        subtotalAmount: 5000,
        eventTitle: "Corrida X",
        buyerName: "Maria",
        buyerEmail: "maria@example.com",
        hasPhone: true,
        lastAlertSentAt: new Date("2026-07-02T00:00:00Z"),
      },
    ]);
  });

  it("não consulta AlertLog quando não há pedidos", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    dbMock.order.count.mockResolvedValueOnce(0);

    const result = await listAbandonedCarts({ AND: [{ status: "PENDING" }] }, [{ createdAt: "desc" }], 0, 20);

    expect(dbMock.alertLog.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/abandoned-cart-query.test.ts`
Expected: FAIL with "Cannot find module '@/lib/alerts/abandoned-cart-query'".

- [ ] **Step 3: Implement `lib/alerts/abandoned-cart-query.ts`**

```ts
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseDateInput } from "@/lib/admin/audit";

export interface AbandonedCartSearchParams {
  q?: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
}

export interface AbandonedCartRow {
  id: string;
  createdAt: Date;
  subtotalAmount: number;
  eventTitle: string;
  buyerName: string;
  buyerEmail: string;
  hasPhone: boolean;
  lastAlertSentAt: Date | null;
}

export function buildAbandonedCartWhere(
  params: Pick<AbandonedCartSearchParams, "q" | "event" | "dateFrom" | "dateTo">,
  scope?: { organizerUserId: string },
): Prisma.OrderWhereInput {
  const filters: Prisma.OrderWhereInput[] = [{ status: "PENDING" }];

  if (scope) {
    filters.push({ event: { organizer: { userId: scope.organizerUserId } } });
  }

  if (params.q) {
    filters.push({
      OR: [
        { buyer: { name: { contains: params.q, mode: "insensitive" as const } } },
        { buyer: { email: { contains: params.q, mode: "insensitive" as const } } },
        { event: { title: { contains: params.q, mode: "insensitive" as const } } },
      ],
    });
  }

  if (params.event) {
    filters.push({ event: { title: { contains: params.event, mode: "insensitive" as const } } });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  return { AND: filters };
}

export function buildAbandonedCartOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.OrderOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "amount":
      return { orderBy: [{ subtotalAmount: normalizedDir }, { createdAt: "desc" }], normalizedSort: "amount", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }], normalizedSort: "createdAt", normalizedDir };
  }
}

export async function listAbandonedCarts(
  where: Prisma.OrderWhereInput,
  orderBy: Prisma.OrderOrderByWithRelationInput[],
  skip: number,
  take: number,
): Promise<{ rows: AbandonedCartRow[]; total: number }> {
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        subtotalAmount: true,
        event: { select: { title: true } },
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      },
    }),
    db.order.count({ where }),
  ]);

  const alertLogs = orders.length
    ? await db.alertLog.findMany({
        where: { alertType: "ABANDONED_CART", entityType: "Order", entityId: { in: orders.map((o) => o.id) } },
        orderBy: { sentAt: "desc" },
      })
    : [];

  const lastAlertByOrder = new Map<string, Date>();
  for (const log of alertLogs) {
    if (!lastAlertByOrder.has(log.entityId)) lastAlertByOrder.set(log.entityId, log.sentAt);
  }

  const rows: AbandonedCartRow[] = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    subtotalAmount: o.subtotalAmount,
    eventTitle: o.event.title,
    buyerName: o.buyer.name,
    buyerEmail: o.buyer.email,
    hasPhone: Boolean(o.buyer.athleteProfile?.phone),
    lastAlertSentAt: lastAlertByOrder.get(o.id) ?? null,
  }));

  return { rows, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/abandoned-cart-query.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/abandoned-cart-query.ts tests/abandoned-cart-query.test.ts
git commit -m "feat: add abandoned cart listing query helper"
```

---

### Task 3: Admin notify API route

**Files:**
- Create: `app/api/admin/abandoned-carts/notify/route.ts`
- Test: `tests/admin-abandoned-carts-notify-route.test.ts`

**Interfaces:**
- Consumes: `sendAbandonedCartAlert` (Task 1), `buildAbandonedCartWhere` (Task 2), `getAbandonedCartAlertSettings` from `lib/alerts/alert-settings.ts`.
- Produces: `POST /api/admin/abandoned-carts/notify` — body `{ orderId: string }` or `{ all: true, q?, event?, dateFrom?, dateTo? }` → `{ notified: number, total: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/admin-abandoned-carts-notify-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/abandoned-cart", () => ({ sendAbandonedCartAlert: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getAbandonedCartAlertSettings: vi.fn() }));

import { POST } from "@/app/api/admin/abandoned-carts/notify/route";
import { auth } from "@/lib/auth";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  buyerUserId: "athlete-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/abandoned-carts/notify", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/abandoned-carts/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true, minutesThreshold: 30 });
  });

  it("retorna 403 quando não é admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ orderId: "order-1" }));
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando o pedido não existe ou não está PENDING", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ orderId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("envia alerta individual com bypassDedupe e grava auditoria", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(sendAbandonedCartAlert).toHaveBeenCalledWith(orderFixture, expect.any(Object), { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "admin-1", action: "ABANDONED_CART_NOTIFICATION_RESENT", entityId: "order-1" }),
      }),
    );
    expect(body).toEqual({ notified: 1, total: 1 });
  });

  it("envia em massa para todos os pedidos que casam com os filtros", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture, { ...orderFixture, id: "order-2" }]);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValue({ sent: true });

    const res = await POST(makeRequest({ all: true, q: "maria" }));
    const body = await res.json();

    expect(sendAbandonedCartAlert).toHaveBeenCalledTimes(2);
    expect(body).toEqual({ notified: 2, total: 2 });
  });

  it("retorna 400 quando não informa orderId nem all", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-abandoned-carts-notify-route.test.ts`
Expected: FAIL — "Cannot find module '@/app/api/admin/abandoned-carts/notify/route'".

- [ ] **Step 3: Implement `app/api/admin/abandoned-carts/notify/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { buildAbandonedCartWhere } from "@/lib/alerts/abandoned-cart-query";

const ORDER_SELECT = {
  id: true,
  buyerUserId: true,
  event: { select: { title: true } },
  buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
} as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const settings = await getAbandonedCartAlertSettings();

  let orders;
  if (body.orderId) {
    const order = await db.order.findFirst({
      where: { id: body.orderId, status: "PENDING" },
      select: ORDER_SELECT,
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    orders = [order];
  } else if (body.all) {
    const where = buildAbandonedCartWhere({ q: body.q, event: body.event, dateFrom: body.dateFrom, dateTo: body.dateTo });
    orders = await db.order.findMany({ where, select: ORDER_SELECT });
  } else {
    return NextResponse.json({ error: "Informe orderId ou all" }, { status: 400 });
  }

  let notified = 0;
  for (const order of orders) {
    const { sent } = await sendAbandonedCartAlert(order, settings, { bypassDedupe: true });
    if (sent) {
      notified++;
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ABANDONED_CART_NOTIFICATION_RESENT",
          entityType: "Order",
          entityId: order.id,
          metadata: { eventTitle: order.event.title },
        },
      });
    }
  }

  return NextResponse.json({ notified, total: orders.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-abandoned-carts-notify-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/abandoned-carts/notify/route.ts tests/admin-abandoned-carts-notify-route.test.ts
git commit -m "feat: add admin route to manually notify abandoned carts"
```

---

### Task 4: Organizer notify API route

**Files:**
- Create: `app/api/organizer/abandoned-carts/notify/route.ts`
- Test: `tests/organizer-abandoned-carts-notify-route.test.ts`

**Interfaces:**
- Consumes: same as Task 3, plus `buildAbandonedCartWhere(params, { organizerUserId })` scoping.
- Produces: `POST /api/organizer/abandoned-carts/notify` — same contract as Task 3, scoped to the
  authenticated organizer's own events (ADMIN role also allowed, per existing convention in
  `app/api/organizer/expire-payments/route.ts`, but still scoped by `session.user.id` — an admin
  hitting this route as themselves will simply match zero events, which is correct: admins use the
  admin route for unscoped access).

- [ ] **Step 1: Write the failing test**

Create `tests/organizer-abandoned-carts-notify-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/abandoned-cart", () => ({ sendAbandonedCartAlert: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getAbandonedCartAlertSettings: vi.fn() }));

import { POST } from "@/app/api/organizer/abandoned-carts/notify/route";
import { auth } from "@/lib/auth";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  buyerUserId: "athlete-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/abandoned-carts/notify", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/abandoned-carts/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true, minutesThreshold: 30 });
  });

  it("retorna 403 quando não é organizador nem admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ orderId: "order-1" }));
    expect(res.status).toBe(403);
  });

  it("busca o pedido individual escopado ao organizador autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    await POST(makeRequest({ orderId: "order-1" }));

    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: { id: "order-1", status: "PENDING", event: { organizer: { userId: "org-user-1" } } },
      select: expect.any(Object),
    });
  });

  it("envia em massa escopado ao organizador autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ all: true }));
    const body = await res.json();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([{ event: { organizer: { userId: "org-user-1" } } }]) }) }),
    );
    expect(body).toEqual({ notified: 1, total: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/organizer-abandoned-carts-notify-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/api/organizer/abandoned-carts/notify/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { buildAbandonedCartWhere } from "@/lib/alerts/abandoned-cart-query";

const ORDER_SELECT = {
  id: true,
  buyerUserId: true,
  event: { select: { title: true } },
  buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
} as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const settings = await getAbandonedCartAlertSettings();
  const scope = { organizerUserId: session.user.id };

  let orders;
  if (body.orderId) {
    const order = await db.order.findFirst({
      where: { id: body.orderId, status: "PENDING", event: { organizer: { userId: session.user.id } } },
      select: ORDER_SELECT,
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    orders = [order];
  } else if (body.all) {
    const where = buildAbandonedCartWhere({ q: body.q, event: body.event, dateFrom: body.dateFrom, dateTo: body.dateTo }, scope);
    orders = await db.order.findMany({ where, select: ORDER_SELECT });
  } else {
    return NextResponse.json({ error: "Informe orderId ou all" }, { status: 400 });
  }

  let notified = 0;
  for (const order of orders) {
    const { sent } = await sendAbandonedCartAlert(order, settings, { bypassDedupe: true });
    if (sent) {
      notified++;
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ABANDONED_CART_NOTIFICATION_RESENT",
          entityType: "Order",
          entityId: order.id,
          metadata: { eventTitle: order.event.title },
        },
      });
    }
  }

  return NextResponse.json({ notified, total: orders.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/organizer-abandoned-carts-notify-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/organizer/abandoned-carts/notify/route.ts tests/organizer-abandoned-carts-notify-route.test.ts
git commit -m "feat: add organizer route to manually notify abandoned carts"
```

---

### Task 5: Shared UI components (row button + bulk button)

**Files:**
- Create: `components/alerts/SendAbandonedCartAlertButton.tsx`
- Create: `components/alerts/SendAllAbandonedCartsButton.tsx`

**Interfaces:**
- Consumes: `ConfirmModal` (`components/ui/ConfirmModal.tsx`), `ErrorModal` (`components/ui/ErrorModal.tsx`).
- Produces: `<SendAbandonedCartAlertButton endpoint={string} orderId={string} />` and
  `<SendAllAbandonedCartsButton endpoint={string} filters={Record<string,string>} count={number} />`
  — both used by Task 6 and Task 7.

No automated test for these two client components — this codebase has no existing test coverage for
equivalent action-button components (`ExpirePaymentsPanel`, `ReconciliationPanel`); manual smoke test
happens in Task 7's verification step.

- [ ] **Step 1: Create `components/alerts/SendAbandonedCartAlertButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

export default function SendAbandonedCartAlertButton({ endpoint, orderId }: { endpoint: string; orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar alerta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleSend}
        disabled={loading}
        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {loading ? "Enviando..." : "Enviar alerta"}
      </button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 2: Create `components/alerts/SendAllAbandonedCartsButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function SendAllAbandonedCartsButton({
  endpoint,
  filters,
  count,
}: {
  endpoint: string;
  filters: Record<string, string>;
  count: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, ...filters }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar alertas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={count === 0}
        className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
      >
        Enviar para todos ({count})
      </button>
      <ConfirmModal
        open={confirming}
        title="Enviar alerta para todos"
        message={`Isso vai enviar um alerta de carrinho abandonado para ${count} pedido(s) pendente(s) que atendem aos filtros atuais. Deseja continuar?`}
        confirmLabel="Enviar"
        tone="default"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/alerts/SendAbandonedCartAlertButton.tsx components/alerts/SendAllAbandonedCartsButton.tsx
git commit -m "feat: add abandoned cart notification buttons"
```

---

### Task 6: Admin page

**Files:**
- Create: `app/admin/carrinhos-abandonados/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `buildAbandonedCartWhere`, `buildAbandonedCartOrderBy`, `listAbandonedCarts` (Task 2),
  `SendAbandonedCartAlertButton`, `SendAllAbandonedCartsButton` (Task 5), `requireAdmin` (`lib/auth/rbac.ts`),
  `formatCurrency`, `formatDate` (`lib/format.ts`).

- [ ] **Step 1: Create `app/admin/carrinhos-abandonados/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { formatCurrency } from "@/lib/format";
import { buildAbandonedCartWhere, buildAbandonedCartOrderBy, listAbandonedCarts } from "@/lib/alerts/abandoned-cart-query";
import SendAbandonedCartAlertButton from "@/components/alerts/SendAbandonedCartAlertButton";
import SendAllAbandonedCartsButton from "@/components/alerts/SendAllAbandonedCartsButton";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Carrinhos abandonados — Admin" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export default async function AdminAbandonedCartsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const event = params.event?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortConfig = buildAbandonedCartOrderBy(params.sort?.trim() ?? "createdAt", params.dir?.trim() ?? "desc");
  const pageSize = 20;
  const where = buildAbandonedCartWhere({ q, event, dateFrom, dateTo });

  const { rows, total } = await listAbandonedCarts(
    where,
    sortConfig.orderBy,
    (Math.max(1, requestedPage) - 1) * pageSize,
    pageSize,
  );

  const hasFilters = Boolean(q) || Boolean(event) || Boolean(dateFrom) || Boolean(dateTo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Carrinhos abandonados</h1>
          <p className="text-sm text-gray-500">{total} pedido(s) pendente(s) encontrado(s)</p>
        </div>
        <SendAllAbandonedCartsButton
          endpoint="/api/admin/abandoned-carts/notify"
          filters={{ q, event, dateFrom, dateTo }}
          count={total}
        />
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} placeholder="Comprador, e-mail ou evento" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Evento</label>
          <input name="event" defaultValue={event} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="md:col-span-5 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          {hasFilters ? <Link href="/admin/carrinhos-abandonados" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum carrinho abandonado encontrado.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
                <th className="pb-2 pr-4">Comprador</th>
                <th className="pb-2 pr-4">Evento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Canais</th>
                <th className="pb-2 pr-4">Pendente há</th>
                <th className="pb-2 pr-4">Último alerta</th>
                <th className="pb-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-2 pr-4">
                    <div>{row.buyerName}</div>
                    <div className="text-xs text-gray-400">{row.buyerEmail}</div>
                  </td>
                  <td className="py-2 pr-4 truncate max-w-xs">{row.eventTitle}</td>
                  <td className="py-2 pr-4 font-medium">{formatCurrency(row.subtotalAmount)}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">
                    E-mail{row.hasPhone ? " + WhatsApp" : ""}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {formatDistanceToNowStrict(row.createdAt, { locale: ptBR })}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {row.lastAlertSentAt ? formatDistanceToNowStrict(row.lastAlertSentAt, { locale: ptBR, addSuffix: true }) : "Nunca"}
                  </td>
                  <td className="py-2">
                    <SendAbandonedCartAlertButton endpoint="/api/admin/abandoned-carts/notify" orderId={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add nav link in `components/admin/AdminNav.tsx`**

Add this line right after the `Pedidos vencidos` link (line 16):

```tsx
          <Link href="/admin/carrinhos-abandonados" className="hover:text-gray-300">Carrinhos abandonados</Link>
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, log in as an admin, visit `/admin/carrinhos-abandonados`. Confirm the page loads
without error (empty state is fine if there are no pending orders in the local DB). If there is at
least one `PENDING` order locally, confirm the row's "Enviar alerta" button completes without a
network error (check DevTools console/network tab — actual email/WhatsApp delivery depends on local
SMTP/WhatsApp config, which is expected to be unset locally and will just skip sending, per existing
`isSmtpReady` guard).

- [ ] **Step 4: Commit**

```bash
git add app/admin/carrinhos-abandonados/page.tsx components/admin/AdminNav.tsx
git commit -m "feat: add admin abandoned carts page"
```

---

### Task 7: Organizer page + final verification

**Files:**
- Create: `app/organizador/carrinhos-abandonados/page.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`

**Interfaces:**
- Consumes: same as Task 6, plus `requireOrganizer` (`lib/auth/rbac.ts`) and organizer scope
  `{ organizerUserId: session.user.id }` passed into `buildAbandonedCartWhere`.

- [ ] **Step 1: Create `app/organizador/carrinhos-abandonados/page.tsx`**

Same structure as the admin page, with these differences: `requireOrganizer()` instead of
`requireAdmin()`, `buildAbandonedCartWhere({ q, event, dateFrom, dateTo }, { organizerUserId: session.user.id })`,
and endpoint `/api/organizer/abandoned-carts/notify` on both buttons, and link `/organizador/carrinhos-abandonados`
for "Limpar".

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { formatCurrency } from "@/lib/format";
import { buildAbandonedCartWhere, buildAbandonedCartOrderBy, listAbandonedCarts } from "@/lib/alerts/abandoned-cart-query";
import SendAbandonedCartAlertButton from "@/components/alerts/SendAbandonedCartAlertButton";
import SendAllAbandonedCartsButton from "@/components/alerts/SendAllAbandonedCartsButton";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Carrinhos abandonados" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export default async function OrganizerAbandonedCartsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireOrganizer();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const event = params.event?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortConfig = buildAbandonedCartOrderBy(params.sort?.trim() ?? "createdAt", params.dir?.trim() ?? "desc");
  const pageSize = 20;
  const where = buildAbandonedCartWhere({ q, event, dateFrom, dateTo }, { organizerUserId: session.user.id });

  const { rows, total } = await listAbandonedCarts(
    where,
    sortConfig.orderBy,
    (Math.max(1, requestedPage) - 1) * pageSize,
    pageSize,
  );

  const hasFilters = Boolean(q) || Boolean(event) || Boolean(dateFrom) || Boolean(dateTo);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Carrinhos abandonados</h1>
          <p className="text-sm text-gray-500">{total} pedido(s) pendente(s) encontrado(s)</p>
        </div>
        <SendAllAbandonedCartsButton
          endpoint="/api/organizer/abandoned-carts/notify"
          filters={{ q, event, dateFrom, dateTo }}
          count={total}
        />
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} placeholder="Comprador, e-mail ou evento" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Evento</label>
          <input name="event" defaultValue={event} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="md:col-span-5 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          {hasFilters ? <Link href="/organizador/carrinhos-abandonados" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum carrinho abandonado encontrado.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
                <th className="pb-2 pr-4">Comprador</th>
                <th className="pb-2 pr-4">Evento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Canais</th>
                <th className="pb-2 pr-4">Pendente há</th>
                <th className="pb-2 pr-4">Último alerta</th>
                <th className="pb-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-2 pr-4">
                    <div>{row.buyerName}</div>
                    <div className="text-xs text-gray-400">{row.buyerEmail}</div>
                  </td>
                  <td className="py-2 pr-4 truncate max-w-xs">{row.eventTitle}</td>
                  <td className="py-2 pr-4 font-medium">{formatCurrency(row.subtotalAmount)}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">
                    E-mail{row.hasPhone ? " + WhatsApp" : ""}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {formatDistanceToNowStrict(row.createdAt, { locale: ptBR })}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {row.lastAlertSentAt ? formatDistanceToNowStrict(row.lastAlertSentAt, { locale: ptBR, addSuffix: true }) : "Nunca"}
                  </td>
                  <td className="py-2">
                    <SendAbandonedCartAlertButton endpoint="/api/organizer/abandoned-carts/notify" orderId={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add nav links in `components/organizer/OrganizerNav.tsx`**

Add this line after each of the two existing `Pedidos vencidos` links (desktop nav around line 20,
mobile nav around line 46 — both need the link since they are separate `<Link>` lists):

```tsx
            <Link href="/organizador/carrinhos-abandonados" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Carrinhos abandonados</Link>
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 4 new test files added in Tasks 1–4 and every
pre-existing test (in particular `tests/alert-abandoned-cart.test.ts`, which must still pass
unmodified in its `checkAbandonedCarts` describe block).

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: build succeeds with no type errors (this repo has no separate `tsc --noEmit` script; `next
build` type-checks as part of the build).

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, log in as an organizer, visit `/organizador/carrinhos-abandonados`. Confirm only
that organizer's own pending orders show up (create a `PENDING` order for one of their events locally
if none exist), and that "Enviar para todos" opens the `ConfirmModal` (not a native browser dialog)
and completes without error.

- [ ] **Step 6: Commit**

```bash
git add app/organizador/carrinhos-abandonados/page.tsx components/organizer/OrganizerNav.tsx
git commit -m "feat: add organizer abandoned carts page"
```

---

## Post-plan housekeeping

After Task 7 is committed and verified: mark task #1 in the session task list as completed, update
the project memory file with what shipped (new routes/pages/helpers, and that `sendAbandonedCartAlert`
now takes a `bypassDedupe` option), and move on to task #2 (filtros e resumo na página do evento) —
brainstorm that sub-project fresh before writing its plan, since it wasn't scoped in detail yet.
