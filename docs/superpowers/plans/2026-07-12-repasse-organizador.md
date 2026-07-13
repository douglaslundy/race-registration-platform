# Fluxo completo de repasse ao organizador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin generate a `TransferPayout` automatically from an event's paid orders, and
move it through `PENDING → PROCESSING/COMPLETED/FAILED` with a note and timestamp — today this is
impossible through the running app (only a full-database backup restore can ever populate this
table).

**Architecture:** `Order` gains a nullable `payoutId` FK so a payout's "generate" action can claim
exactly the paid orders not yet covered by any prior payout (no double-counting, no date-based
heuristics). Two new service modules (`lib/admin/generate-payout.ts`,
`lib/admin/update-payout-status.ts`) hold the business logic; three new API routes are thin HTTP
wrappers around them, following this codebase's established pattern (see
`lib/registrations/cancellation-decision-service.ts` +
`app/api/admin/registrations/[id]/cancellation-decision/route.ts`: a service returns a `{ok:true,
...} | {ok:false, status, error}` discriminated union, the route just translates that to an HTTP
response). Two new client components (`GeneratePayoutButton`, `UpdatePayoutStatusButton`) wire the
existing `ConfirmModal`/`ErrorModal` pair into the admin event page and the admin repasses list.

**Tech Stack:** Next.js App Router route handlers, Prisma (Postgres), Vitest, React client
components with the existing `ConfirmModal`/`ErrorModal` pair (per `CLAUDE.md` — no native
`confirm()`/`alert()`).

## Global Constraints

- Money is centavos (integers) everywhere — no float arithmetic.
- Payout formula (confirmed with the user):
  `grossAmount = Σ Order.totalAmount`, `platformFee = Σ Order.platformFeeAmount + Σ
  Order.paymentFeeAmount`, `netAmount = grossAmount - platformFee` — over `Order`s with
  `eventId`, `status: "PAID"`, `payoutId: null`.
- Only `ADMIN` role can generate a payout or change its status — organizer stays fully read-only
  (`app/organizador/relatorio/page.tsx` needs no code change; it already sums whatever
  `TransferPayout` rows exist).
- Status machine: `PENDING → PROCESSING | COMPLETED | FAILED`; `PROCESSING → COMPLETED | FAILED`;
  `COMPLETED`/`FAILED` are terminal. `processedAt` is set only when entering `COMPLETED` or
  `FAILED`. Transitioning to `FAILED` releases the payout's orders (`payoutId` set back to `null`)
  so a corrected payout can be generated later — otherwise those orders would be permanently
  unpayable through the app, the same "money stuck forever" pattern the previous task in this
  session fixed for card payments.
- A payout's financial fields (`grossAmount`/`platformFee`/`netAmount`/`eventId`/`organizerId`) are
  immutable once created — only `status`/`processedAt`/`notes` are ever updated after creation.
- Service functions return `{ ok: true; ... } | { ok: false; status: number; error: string }` —
  this is a slight refinement over the design spec's `{ payout } | { error }` sketch, adopted
  during planning to match this codebase's established service/route split (see
  `cancellation-decision-service.ts`). Not a behavior change, just an internal consistency choice.
- Do not touch `lib/organizer/report.ts`, `app/organizador/relatorio/page.tsx`, or
  `app/admin/repasses/page.tsx`'s existing filters/sort/export — only additive changes (new column,
  new badge) to the repasses list.
- `prisma migrate dev` cannot run in this environment (no live DB connection) — Task 1 hand-writes
  the migration SQL file directly (matching the exact format Prisma already generates, verified
  against `prisma/migrations/20260620000000_coupons_global_and_creator/migration.sql`) and runs
  only `npx prisma generate` (schema-only, no DB needed) to refresh the TS client types. The
  migration is applied to production via `prisma db push` at the next deploy, same as prior
  migrations this session (see `[[deploy_vps_process]]` memory).

---

### Task 1: Schema — `Order.payoutId`

**Files:**
- Modify: `prisma/schema.prisma` (`Order` model, `TransferPayout` model)
- Create: `prisma/migrations/20260712000000_add_order_payout_id/migration.sql`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Order.payoutId: string | null` and the `Order.payout` / `TransferPayout.orders`
  Prisma relation — every later task's Prisma queries (`payoutId: null` filters, `updateMany`,
  `orders: { where: { status: "REFUNDED" } }` includes) depend on this existing first.

- [ ] **Step 1: Edit `Order` and `TransferPayout` in `prisma/schema.prisma`**

Find the `Order` model (currently starting at `model Order {` around line 339). Add `payoutId` as
a field, `payout` as a relation, and a new index — insert alongside the existing `couponId`/
`coupon` field+relation pair for the closest existing precedent (same nullable-FK-with-relation
shape):

```prisma
model Order {
  id                String      @id @default(cuid())
  buyerUserId       String
  eventId           String
  subtotalAmount    Int         // centavos
  platformFeeAmount Int         // centavos
  paymentFeeAmount  Int         // centavos
  totalAmount       Int         // centavos
  currency          String      @default("BRL")
  couponId          String?
  payoutId          String?
  discountAmount    Int         @default(0)
  status            OrderStatus @default(PENDING)
  expiresAt         DateTime?
  confirmationEmailSentAt DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  buyer         User            @relation(fields: [buyerUserId], references: [id])
  event         Event           @relation(fields: [eventId], references: [id])
  coupon        Coupon?         @relation(fields: [couponId], references: [id])
  payout        TransferPayout? @relation(fields: [payoutId], references: [id])
  payments      Payment[]
  registrations Registration[]

  @@index([buyerUserId])
  @@index([eventId, status])
  @@index([payoutId])
  @@map("orders")
}
```

(Only `payoutId` field, `payout` relation, and `@@index([payoutId])` are new — every other line is
existing, shown for exact placement.)

Find the `TransferPayout` model and add the reverse relation `orders Order[]` (existing fields
`processedAt`/`notes` are unchanged — they start being used by Task 4, not this task):

```prisma
model TransferPayout {
  id           String       @id @default(cuid())
  eventId      String
  organizerId  String
  grossAmount  Int          // centavos
  platformFee  Int          // centavos
  netAmount    Int          // centavos
  status       PayoutStatus @default(PENDING)
  processedAt  DateTime?
  notes        String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  event     Event            @relation(fields: [eventId], references: [id])
  organizer OrganizerProfile @relation(fields: [organizerId], references: [id])
  orders    Order[]

  @@map("transfer_payouts")
}
```

- [ ] **Step 2: Hand-write the migration file**

Create `prisma/migrations/20260712000000_add_order_payout_id/migration.sql`:

```sql
-- Order.payoutId: vincula um pedido ao repasse que o cobre, evitando contar o mesmo pedido em
-- dois repasses (repasses incrementais só pegam pedidos ainda com payoutId nulo)
ALTER TABLE "orders" ADD COLUMN "payoutId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "transfer_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "orders_payoutId_idx" ON "orders"("payoutId");
```

- [ ] **Step 3: Regenerate the Prisma client (schema-only, no DB needed)**

Run: `npx prisma generate`

Expected: succeeds and prints `Generated Prisma Client`. This does not touch any database — it
only reads `prisma/schema.prisma` and regenerates `node_modules/@prisma/client`'s TypeScript types
so `payoutId`/`payout`/`orders` are available to the compiler in later tasks.

- [ ] **Step 4: Confirm the rest of the codebase still type-checks**

Run: `npx tsc --noEmit`

Expected: clean (no new errors — this task doesn't reference the new field anywhere in application
code yet, so this just confirms the schema edit and regeneration didn't break anything existing).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260712000000_add_order_payout_id
git commit -m "feat: add Order.payoutId to support incremental payout generation"
```

---

### Task 2: Payout calculation + refund-warning helper

**Files:**
- Create: `lib/admin/generate-payout.ts`
- Modify: `lib/admin/payouts.ts` (append `hasPostPayoutRefund`)
- Modify: `tests/setup.ts` (extend `order`/`transferPayout` mocks)
- Test: `tests/generate-payout.test.ts` (new)
- Test: `tests/admin-payouts-helpers.test.ts` (new, only `hasPostPayoutRefund`)

**Interfaces:**
- Consumes: `Order.payoutId` (Task 1).
- Produces: `computeEligiblePayoutTotals(eventId: string): Promise<PayoutPreview>` and
  `generatePayout(eventId: string): Promise<GeneratePayoutResult>` — Task 3's routes call these
  directly. `hasPostPayoutRefund(orders: { status: string }[]): boolean` — Task 5's repasses list
  page calls this.

- [ ] **Step 1: Extend the Prisma mocks in `tests/setup.ts`**

Current (line 11):
```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```
Replace with:
```ts
    order: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

Current (line 14):
```ts
    transferPayout: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
```
Replace with:
```ts
    transferPayout: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), create: vi.fn(), update: vi.fn() },
```

- [ ] **Step 2: Write `lib/admin/generate-payout.ts`**

```ts
import { db } from "@/lib/db";

export interface PayoutPreview {
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

export async function computeEligiblePayoutTotals(eventId: string): Promise<PayoutPreview> {
  const agg = await db.order.aggregate({
    where: { eventId, status: "PAID", payoutId: null },
    _count: { id: true },
    _sum: { totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  const grossAmount = agg._sum.totalAmount ?? 0;
  const platformFee = (agg._sum.platformFeeAmount ?? 0) + (agg._sum.paymentFeeAmount ?? 0);
  return { orderCount: agg._count.id, grossAmount, platformFee, netAmount: grossAmount - platformFee };
}

export type GeneratePayoutResult =
  | { ok: true; payout: { id: string; grossAmount: number; platformFee: number; netAmount: number } }
  | { ok: false; status: number; error: string };

export async function generatePayout(eventId: string): Promise<GeneratePayoutResult> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
  if (!event) return { ok: false, status: 404, error: "Evento não encontrado" };

  const orders = await db.order.findMany({
    where: { eventId, status: "PAID", payoutId: null },
    select: { id: true, totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  if (orders.length === 0) {
    return { ok: false, status: 400, error: "Nenhum pedido pago pendente de repasse para este evento." };
  }

  const grossAmount = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const platformFee = orders.reduce((sum, o) => sum + o.platformFeeAmount + o.paymentFeeAmount, 0);
  const netAmount = grossAmount - platformFee;

  const payout = await db.$transaction(async (tx) => {
    const created = await tx.transferPayout.create({
      data: { eventId, organizerId: event.organizerId, grossAmount, platformFee, netAmount },
    });
    await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { payoutId: created.id },
    });
    await tx.auditLog.create({
      data: {
        action: "PAYOUT_GENERATED",
        entityType: "TransferPayout",
        entityId: created.id,
        metadata: { eventId, orderCount: orders.length, grossAmount, netAmount },
      },
    });
    return created;
  });

  return {
    ok: true,
    payout: { id: payout.id, grossAmount: payout.grossAmount, platformFee: payout.platformFee, netAmount: payout.netAmount },
  };
}
```

- [ ] **Step 3: Append `hasPostPayoutRefund` to `lib/admin/payouts.ts`**

Add at the end of the file (after the existing `export { escapeCsvValue };` line):

```ts
export function hasPostPayoutRefund(orders: { status: string }[]): boolean {
  return orders.length > 0;
}
```

(`orders` is expected to already be pre-filtered to `status: "REFUNDED"` by the caller's Prisma
query — this function just names the "any refunded order in this payout's set" check so it isn't
inline JSX logic. See Task 5.)

- [ ] **Step 4: Write `tests/admin-payouts-helpers.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { hasPostPayoutRefund } from "@/lib/admin/payouts";

describe("hasPostPayoutRefund", () => {
  it("returns false for an empty array", () => {
    expect(hasPostPayoutRefund([])).toBe(false);
  });

  it("returns true when at least one order is present", () => {
    expect(hasPostPayoutRefund([{ status: "REFUNDED" }])).toBe(true);
  });

  it("returns true for multiple orders", () => {
    expect(hasPostPayoutRefund([{ status: "REFUNDED" }, { status: "REFUNDED" }])).toBe(true);
  });
});
```

- [ ] **Step 5: Write `tests/generate-payout.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeEligiblePayoutTotals, generatePayout } from "@/lib/admin/generate-payout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("computeEligiblePayoutTotals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeros when there are no eligible orders", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 0 },
      _sum: { totalAmount: null, platformFeeAmount: null, paymentFeeAmount: null },
    });
    const result = await computeEligiblePayoutTotals("event-1");
    expect(result).toEqual({ orderCount: 0, grossAmount: 0, platformFee: 0, netAmount: 0 });
    expect(dbMock.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "PAID", payoutId: null } }),
    );
  });

  it("computes gross/platformFee/net from aggregated sums", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 2 },
      _sum: { totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    });
    const result = await computeEligiblePayoutTotals("event-1");
    expect(result).toEqual({ orderCount: 2, grossAmount: 10700, platformFee: 700, netAmount: 10000 });
  });
});

describe("generatePayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the event does not exist", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce(null);
    const result = await generatePayout("event-1");
    expect(result).toEqual({ ok: false, status: 404, error: "Evento não encontrado" });
  });

  it("returns 400 when there are no eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const result = await generatePayout("event-1");
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Nenhum pedido pago pendente de repasse para este evento.",
    });
  });

  it("creates the payout, claims the eligible orders, and writes the audit log", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([
      { id: "order-1", totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
      { id: "order-2", totalAmount: 5350, platformFeeAmount: 250, paymentFeeAmount: 100 },
    ]);

    const txMock = {
      transferPayout: {
        create: vi.fn().mockResolvedValueOnce({
          id: "payout-1",
          grossAmount: 16050,
          platformFee: 1050,
          netAmount: 15000,
        }),
      },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const result = await generatePayout("event-1");

    expect(txMock.transferPayout.create).toHaveBeenCalledWith({
      data: { eventId: "event-1", organizerId: "org-1", grossAmount: 16050, platformFee: 1050, netAmount: 15000 },
    });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["order-1", "order-2"] } },
      data: { payoutId: "payout-1" },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAYOUT_GENERATED",
          entityType: "TransferPayout",
          entityId: "payout-1",
          metadata: { eventId: "event-1", orderCount: 2, grossAmount: 16050, netAmount: 15000 },
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      payout: { id: "payout-1", grossAmount: 16050, platformFee: 1050, netAmount: 15000 },
    });
  });
});
```

- [ ] **Step 6: Run the new tests and confirm they pass**

Run: `npx vitest run tests/generate-payout.test.ts tests/admin-payouts-helpers.test.ts`

Expected: PASS, all tests.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (the `tests/setup.ts` mock extensions in Step 1 are additive — no test
that used `order`/`transferPayout` before should break).

- [ ] **Step 8: Commit**

```bash
git add lib/admin/generate-payout.ts lib/admin/payouts.ts tests/setup.ts tests/generate-payout.test.ts tests/admin-payouts-helpers.test.ts
git commit -m "feat: compute and generate organizer payouts from paid orders"
```

---

### Task 3: Generate-payout API routes (preview + create)

**Files:**
- Create: `app/api/admin/events/[id]/payouts/preview/route.ts`
- Create: `app/api/admin/events/[id]/payouts/route.ts`
- Test: `tests/admin-event-payouts-preview-route.test.ts` (new)
- Test: `tests/admin-event-payouts-create-route.test.ts` (new)

**Interfaces:**
- Consumes: `computeEligiblePayoutTotals`, `generatePayout` (Task 2).
- Produces: `GET /api/admin/events/:id/payouts/preview` → `200 PayoutPreview | 403 | 404`;
  `POST /api/admin/events/:id/payouts` → `201 {payout} | 400 {error} | 403 | 404` — Task 5's
  `GeneratePayoutButton` calls both.

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-event-payouts-preview-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/events/[id]/payouts/preview/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("admin event payouts preview api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 404 when the event does not exist", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(404);
  });

  it("returns the computed preview totals", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 1 },
      _sum: { totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    });
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderCount: 1, grossAmount: 10700, platformFee: 700, netAmount: 10000 });
  });
});
```

Create `tests/admin-event-payouts-create-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/events/[id]/payouts/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("admin event payouts create api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 400 when there are no eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nenhum pedido/i);
  });

  it("creates the payout and returns 201", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([
      { id: "order-1", totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    ]);
    const txMock = {
      transferPayout: {
        create: vi.fn().mockResolvedValueOnce({ id: "payout-1", grossAmount: 10700, platformFee: 700, netAmount: 10000 }),
      },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      payout: { id: "payout-1", grossAmount: 10700, platformFee: 700, netAmount: 10000 },
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/admin-event-payouts-preview-route.test.ts tests/admin-event-payouts-create-route.test.ts`

Expected: FAIL — neither route file exists yet (module not found).

- [ ] **Step 3: Write the routes**

Create `app/api/admin/events/[id]/payouts/preview/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeEligiblePayoutTotals } from "@/lib/admin/generate-payout";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const event = await db.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const preview = await computeEligiblePayoutTotals(id);
  return NextResponse.json(preview);
}
```

Create `app/api/admin/events/[id]/payouts/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generatePayout } from "@/lib/admin/generate-payout";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const result = await generatePayout(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ payout: result.payout }, { status: 201 });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/admin-event-payouts-preview-route.test.ts tests/admin-event-payouts-create-route.test.ts`

Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/events/[id]/payouts
git add tests/admin-event-payouts-preview-route.test.ts tests/admin-event-payouts-create-route.test.ts
git commit -m "feat: add admin routes to preview and generate event payouts"
```

---

### Task 4: Payout status transitions

**Files:**
- Create: `lib/admin/update-payout-status.ts`
- Create: `app/api/admin/payouts/[id]/route.ts`
- Test: `tests/update-payout-status.test.ts` (new)
- Test: `tests/admin-payout-status-route.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks (independent of Tasks 2-3 beyond the schema from Task 1 —
  `TransferPayout.orders` relation, used to release orders on `FAILED`).
- Produces: `PATCH /api/admin/payouts/:id` → `200 {payout} | 400 {error} | 403 | 404` — Task 5's
  `UpdatePayoutStatusButton` calls this.

- [ ] **Step 1: Write the failing test for the service**

Create `tests/update-payout-status.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePayoutStatus } from "@/lib/admin/update-payout-status";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("updatePayoutStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the payout does not exist", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce(null);
    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      actingUserId: "admin-1",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Repasse não encontrado" });
  });

  it("rejects a transition out of a terminal status", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" });
    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      actingUserId: "admin-1",
    });
    expect(result).toEqual({ ok: false, status: 400, error: "Repasse já está em estado final" });
  });

  it("moves PENDING to PROCESSING without setting processedAt or releasing orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "PROCESSING" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      note: "Enviado para o banco",
      actingUserId: "admin-1",
    });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "PROCESSING", notes: "Enviado para o banco" },
    });
    expect(txMock.order.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, payout: { id: "payout-1", status: "PROCESSING" } });
  });

  it("moves PENDING to COMPLETED, sets processedAt, does not release orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    await updatePayoutStatus({ payoutId: "payout-1", newStatus: "COMPLETED", actingUserId: "admin-1" });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "COMPLETED", processedAt: expect.any(Date) },
    });
    expect(txMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("moves PROCESSING to FAILED, sets processedAt, and releases the payout's orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PROCESSING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "FAILED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    await updatePayoutStatus({ payoutId: "payout-1", newStatus: "FAILED", actingUserId: "admin-1" });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "FAILED", processedAt: expect.any(Date) },
    });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { payoutId: "payout-1" },
      data: { payoutId: null },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAYOUT_STATUS_UPDATED",
          entityType: "TransferPayout",
          entityId: "payout-1",
          metadata: { previousStatus: "PROCESSING", newStatus: "FAILED", note: null },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/update-payout-status.test.ts`

Expected: FAIL — module `@/lib/admin/update-payout-status` doesn't exist yet.

- [ ] **Step 3: Write `lib/admin/update-payout-status.ts`**

```ts
import { db } from "@/lib/db";

export type UpdatePayoutStatusResult =
  | { ok: true; payout: { id: string; status: string } }
  | { ok: false; status: number; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING", "COMPLETED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export async function updatePayoutStatus(params: {
  payoutId: string;
  newStatus: "PROCESSING" | "COMPLETED" | "FAILED";
  note?: string;
  actingUserId: string;
}): Promise<UpdatePayoutStatusResult> {
  const payout = await db.transferPayout.findUnique({
    where: { id: params.payoutId },
    select: { id: true, status: true },
  });
  if (!payout) return { ok: false, status: 404, error: "Repasse não encontrado" };

  const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];
  if (!allowed.includes(params.newStatus)) {
    return { ok: false, status: 400, error: "Repasse já está em estado final" };
  }

  const isTerminal = params.newStatus === "COMPLETED" || params.newStatus === "FAILED";

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.transferPayout.update({
      where: { id: params.payoutId },
      data: {
        status: params.newStatus,
        ...(params.note !== undefined ? { notes: params.note } : {}),
        ...(isTerminal ? { processedAt: new Date() } : {}),
      },
    });

    if (params.newStatus === "FAILED") {
      await tx.order.updateMany({ where: { payoutId: params.payoutId }, data: { payoutId: null } });
    }

    await tx.auditLog.create({
      data: {
        userId: params.actingUserId,
        action: "PAYOUT_STATUS_UPDATED",
        entityType: "TransferPayout",
        entityId: params.payoutId,
        metadata: { previousStatus: payout.status, newStatus: params.newStatus, note: params.note ?? null },
      },
    });

    return result;
  });

  return { ok: true, payout: { id: updated.id, status: updated.status } };
}
```

- [ ] **Step 4: Run the service test and confirm it passes**

Run: `npx vitest run tests/update-payout-status.test.ts`

Expected: PASS, all 5 tests.

- [ ] **Step 5: Write the failing route test**

Create `tests/admin-payout-status-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/payouts/[id]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "payout-1" }) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/payouts/payout-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

describe("admin payout status api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ status: "PROCESSING" }), ctx);
    expect(res.status).toBe(403);
  });

  it("rejects an invalid status value", async () => {
    const res = await PATCH(makeRequest({ status: "PENDING" }), ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the payout does not exist", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ status: "PROCESSING" }), ctx);
    expect(res.status).toBe(404);
  });

  it("updates the status on a valid transition", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await PATCH(makeRequest({ status: "COMPLETED", note: "Pago via TED" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ payout: { id: "payout-1", status: "COMPLETED" } });
  });
});
```

- [ ] **Step 6: Run the route test and confirm it fails**

Run: `npx vitest run tests/admin-payout-status-route.test.ts`

Expected: FAIL — route file doesn't exist yet.

- [ ] **Step 7: Write `app/api/admin/payouts/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updatePayoutStatus } from "@/lib/admin/update-payout-status";

const schema = z.object({
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await updatePayoutStatus({
    payoutId: id,
    newStatus: parsed.data.status,
    note: parsed.data.note,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ payout: result.payout });
}
```

- [ ] **Step 8: Run the route test and confirm it passes**

Run: `npx vitest run tests/admin-payout-status-route.test.ts`

Expected: PASS, all 4 tests.

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/admin/update-payout-status.ts "app/api/admin/payouts/[id]/route.ts"
git add tests/update-payout-status.test.ts tests/admin-payout-status-route.test.ts
git commit -m "feat: add admin route to transition payout status with audit trail"
```

---

### Task 5: UI wiring + backup compatibility

**Files:**
- Create: `components/admin/GeneratePayoutButton.tsx`
- Create: `components/admin/UpdatePayoutStatusButton.tsx`
- Modify: `app/admin/eventos/[id]/page.tsx`
- Modify: `app/admin/repasses/page.tsx`
- Modify: `app/api/admin/backup/import/route.ts` (`toOrderRow`)
- Modify: `tests/backup-import-route.test.ts`

**Interfaces:**
- Consumes: `GET/POST /api/admin/events/:id/payouts(/preview)` (Task 3), `PATCH
  /api/admin/payouts/:id` (Task 4), `hasPostPayoutRefund` (Task 2).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write `components/admin/GeneratePayoutButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import { formatCurrency } from "@/lib/format";

interface PayoutPreview {
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

export default function GeneratePayoutButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const router = useRouter();

  async function openModal() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${eventId}/payouts/preview`);
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao calcular o repasse.");
      return;
    }
    const data: PayoutPreview = await res.json();
    if (data.orderCount === 0) {
      setError("Nenhum pedido pago pendente de repasse para este evento.");
      return;
    }
    setPreview(data);
    setOpen(true);
  }

  async function handleConfirm() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${eventId}/payouts`, { method: "POST" });
    setLoading(false);
    setOpen(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao gerar o repasse.");
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={loading}
        className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded hover:bg-primary-200 disabled:opacity-50"
      >
        Gerar repasse
      </button>

      <ConfirmModal
        open={open}
        title="Gerar repasse"
        message={
          preview
            ? `${preview.orderCount} pedido(s) pago(s) pendente(s) de repasse.\n\nBruto: ${formatCurrency(preview.grossAmount)}\nTaxa da plataforma: ${formatCurrency(preview.platformFee)}\nLíquido a repassar: ${formatCurrency(preview.netAmount)}`
            : ""
        }
        confirmLabel="Gerar repasse"
        tone="success"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 2: Write `components/admin/UpdatePayoutStatusButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface StatusOption {
  value: "PROCESSING" | "COMPLETED" | "FAILED";
  label: string;
  tone: "default" | "danger" | "success";
}

const NEXT_STATUSES: Record<string, StatusOption[]> = {
  PENDING: [
    { value: "PROCESSING", label: "Processando", tone: "default" },
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  PROCESSING: [
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  COMPLETED: [],
  FAILED: [],
};

export default function UpdatePayoutStatusButton({ payoutId, status }: { payoutId: string; status: string }) {
  const [pendingStatus, setPendingStatus] = useState<StatusOption["value"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const options = NEXT_STATUSES[status] ?? [];
  const pending = options.find((o) => o.value === pendingStatus) ?? null;

  async function handleConfirm(note?: string) {
    if (!pendingStatus) return;
    setLoading(true);
    const res = await fetch(`/api/admin/payouts/${payoutId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: pendingStatus, note }),
    });
    setLoading(false);
    setPendingStatus(null);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao atualizar o status do repasse.");
  }

  if (options.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setPendingStatus(o.value)}
            className="text-xs text-primary-600 hover:underline"
          >
            {o.label}
          </button>
        ))}
      </div>

      <ConfirmModal
        open={pending !== null}
        title={`Marcar repasse como "${pending?.label ?? ""}"`}
        message="Você pode adicionar uma observação (opcional)."
        confirmLabel="Confirmar"
        tone={pending?.tone ?? "default"}
        loading={loading}
        showNoteField
        notePlaceholder="Observação (opcional)"
        onConfirm={handleConfirm}
        onCancel={() => setPendingStatus(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 3: Wire `GeneratePayoutButton` into the admin event page**

In `app/admin/eventos/[id]/page.tsx`, add the import near the other admin component imports
(next to `ApproveEventButton`):

```tsx
import ApproveEventButton from "@/components/admin/ApproveEventButton";
import GeneratePayoutButton from "@/components/admin/GeneratePayoutButton";
```

Then, in the header block that currently renders `ApproveEventButton` conditionally (around line
98-107):

```tsx
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{MODALITY_LABEL[event.modality] ?? event.modality} · {formatDate(event.startAt)} · {event.city}/{event.state}</p>
          <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded mt-1 inline-block">{EVENT_STATUS_LABEL[event.status] ?? event.status}</span>
        </div>
        {event.status === "UNDER_REVIEW" && (
          <ApproveEventButton eventId={event.id} />
        )}
      </div>
```

replace with:

```tsx
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{MODALITY_LABEL[event.modality] ?? event.modality} · {formatDate(event.startAt)} · {event.city}/{event.state}</p>
          <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded mt-1 inline-block">{EVENT_STATUS_LABEL[event.status] ?? event.status}</span>
        </div>
        <div className="flex items-center gap-2">
          <GeneratePayoutButton eventId={event.id} />
          {event.status === "UNDER_REVIEW" && (
            <ApproveEventButton eventId={event.id} />
          )}
        </div>
      </div>
```

- [ ] **Step 4: Add the refund-warning query and Ações column to the admin repasses list**

In `app/admin/repasses/page.tsx`, add the import:

```tsx
import { buildAdminPayoutOrderBy, buildAdminPayoutWhere, hasPostPayoutRefund } from "@/lib/admin/payouts";
import UpdatePayoutStatusButton from "@/components/admin/UpdatePayoutStatusButton";
```

In the `db.transferPayout.findMany` call (currently lines 71-80), add the refunded-orders include:

```tsx
    db.transferPayout.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        event: { select: { title: true } },
        organizer: { include: { user: { select: { name: true } } } },
        orders: { where: { status: "REFUNDED" }, select: { id: true } },
      },
    }),
```

Add a new table header cell after the existing "Data" header (end of `<tr>` in `<thead>`, currently
lines 214-234):

```tsx
                <th className="pb-2">
                  <SortLink label="Data" column="createdAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("createdAt")} />
                </th>
                <th className="pb-2">Ações</th>
```

Add the warning badge next to the status badge, and a new cell with the action buttons, in the row
render (currently lines 244-247):

```tsx
                  <td className={cellPadding}>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? ""}`}>{p.status}</span>
                    {hasPostPayoutRefund(p.orders) && (
                      <span className="ml-1 text-xs text-red-600" title="Um ou mais pedidos deste repasse foram estornados depois">⚠</span>
                    )}
                  </td>
                  <td className={cellPadding + " text-gray-400 text-xs whitespace-nowrap"}>{formatDate(p.createdAt)}</td>
                  <td className={cellPadding}>
                    <UpdatePayoutStatusButton payoutId={p.id} status={p.status} />
                  </td>
```

- [ ] **Step 5: Add `payoutId` to the backup import's `toOrderRow`**

In `app/api/admin/backup/import/route.ts`, in `toOrderRow` (currently lines 175-191), add the new
field next to `couponId` (same nullable-string pattern):

```ts
function toOrderRow(row: Row): Prisma.OrderCreateManyInput {
  return {
    id: s(row.id),
    buyerUserId: s(row.buyerUserId),
    eventId: s(row.eventId),
    subtotalAmount: n(row.subtotalAmount),
    platformFeeAmount: n(row.platformFeeAmount),
    paymentFeeAmount: n(row.paymentFeeAmount),
    totalAmount: n(row.totalAmount),
    currency: s(row.currency) || "BRL",
    couponId: sn(row.couponId),
    payoutId: sn(row.payoutId),
    discountAmount: n(row.discountAmount),
    status: s(row.status) as Prisma.OrderCreateManyInput["status"],
    expiresAt: dn(row.expiresAt),
    createdAt: d(row.createdAt),
  };
}
```

- [ ] **Step 6: Extend `tests/backup-import-route.test.ts`**

In `tests/backup-import-route.test.ts`, in the `"wipes every table before inserting, in FK-safe
order, and reports counts"` test, the current payload's `orders` array (right after `events`) is:

```ts
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 100, platformFeeAmount: 10,
            paymentFeeAmount: 5, totalAmount: 115, status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
```

Replace it with (adds a `transferPayouts` array right before it, and `payoutId: "tp1"` to the order
row):

```ts
        transferPayouts: [
          {
            id: "tp1", eventId: "e1", organizerId: "org-1", grossAmount: 100, platformFee: 10,
            netAmount: 90, status: "PENDING", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 100, platformFeeAmount: 10,
            paymentFeeAmount: 5, totalAmount: 115, payoutId: "tp1", status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
```

Then replace the current assertion block:

```ts
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "users").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "events").restored).toBe(1);
    expect(data.totalRestored).toBe(5);

    expect(callOrder.indexOf("delete:registration")).toBeLessThan(callOrder.indexOf("delete:event"));
    expect(callOrder.indexOf("delete:payment")).toBeLessThan(callOrder.indexOf("delete:order"));
    expect(callOrder.indexOf("delete:raceResult")).toBeLessThan(callOrder.indexOf("delete:resultImport"));
    expect(callOrder.indexOf("delete:organizerProfile")).toBeLessThan(callOrder.indexOf("delete:user"));
    expect(callOrder.indexOf("delete:user")).toBeLessThan(callOrder.indexOf("create:user"));
    expect(callOrder.indexOf("create:user")).toBeLessThan(callOrder.indexOf("create:event"));
    expect(callOrder.indexOf("create:event")).toBeLessThan(callOrder.indexOf("create:registration"));
    expect(callOrder.indexOf("create:order")).toBeLessThan(callOrder.indexOf("create:payment"));
  });
```

with:

```ts
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "users").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "events").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "transferPayouts").restored).toBe(1);
    expect(data.totalRestored).toBe(6);

    expect(callOrder.indexOf("delete:registration")).toBeLessThan(callOrder.indexOf("delete:event"));
    expect(callOrder.indexOf("delete:payment")).toBeLessThan(callOrder.indexOf("delete:order"));
    expect(callOrder.indexOf("delete:raceResult")).toBeLessThan(callOrder.indexOf("delete:resultImport"));
    expect(callOrder.indexOf("delete:organizerProfile")).toBeLessThan(callOrder.indexOf("delete:user"));
    expect(callOrder.indexOf("delete:order")).toBeLessThan(callOrder.indexOf("delete:transferPayout"));
    expect(callOrder.indexOf("delete:user")).toBeLessThan(callOrder.indexOf("create:user"));
    expect(callOrder.indexOf("create:user")).toBeLessThan(callOrder.indexOf("create:event"));
    expect(callOrder.indexOf("create:event")).toBeLessThan(callOrder.indexOf("create:registration"));
    expect(callOrder.indexOf("create:transferPayout")).toBeLessThan(callOrder.indexOf("create:order"));
    expect(callOrder.indexOf("create:order")).toBeLessThan(callOrder.indexOf("create:payment"));

    expect(tx.order.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ payoutId: "tp1" })]) }),
    );
  });
```

- [ ] **Step 7: Run the extended backup test and confirm it passes**

Run: `npx vitest run tests/backup-import-route.test.ts`

Expected: PASS, including the new ordering and round-trip assertions.

- [ ] **Step 8: Run the full suite and type-check**

Run: `npx vitest run` and `npx tsc --noEmit`

Expected: all tests pass, no type errors.

- [ ] **Step 9: Manual verification note**

The database is unreachable from this environment (no SSH/DB access), so the UI cannot be
click-tested against real data here. After deploy, verify manually: generate a payout on an event
with paid orders, confirm the numbers match `Order.totalAmount`/`platformFeeAmount`/
`paymentFeeAmount` sums; move it through PENDING → COMPLETED and confirm `processedAt`/`notes`
persist; refund one of its orders and confirm the ⚠ badge appears on `/admin/repasses`; mark a
different payout FAILED and confirm its orders become eligible again in a fresh "Gerar repasse"
preview.

- [ ] **Step 10: Commit**

```bash
git add components/admin/GeneratePayoutButton.tsx components/admin/UpdatePayoutStatusButton.tsx
git add "app/admin/eventos/[id]/page.tsx" app/admin/repasses/page.tsx
git add app/api/admin/backup/import/route.ts tests/backup-import-route.test.ts
git commit -m "feat: wire payout generation and status UI into admin event and repasses pages"
```
