# Dashboards admin e organizador com gráficos de linha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add line charts to the existing admin and organizer dashboard pages — new signups
(admin only), registrations (both, with an optional per-event filter), and coupon usage (both) —
with no new npm dependency.

**Architecture:** A presentational `components/ui/LineChart.tsx` (server component, plain SVG,
zero interactivity) renders whatever `{label, value}[]` it's given. A new shared
`lib/dashboard-metrics.ts` does all the date-bucketing and Prisma queries, returning data already
shaped for the chart. Both dashboard pages get a `de`/`ate`/`eventId` GET filter (same pattern
already used by `/admin/relatorio` and `/organizador/relatorio`), defaulting to the last 30 days,
and two or three new `<div className="card">` blocks calling the shared lib functions.

**Tech Stack:** Next.js App Router server components, Prisma, Vitest. No new dependencies.

## Global Constraints

- No new npm package — charts are hand-rolled SVG.
- Every chart series has exactly one point per calendar day across `[from, to]` inclusive, with
  zero-count days filled in (never a sparse/partial series).
- `getDailyRegistrations`'s `organizerId` and `eventId` scope filters combine with AND when both
  are present — never `eventId`-only when `organizerId` is also given. This prevents an organizer
  from viewing another organizer's event data by hand-editing the `eventId` query param, even
  though the `<select>` itself only ever lists that organizer's own events.
- "Coupon usage" means `Order.couponId != null` at `Order.createdAt` — the same moment
  `lib/checkout.ts:103` increments `Coupon.usedCount`, not a new definition.
- Purely additive to both dashboard pages — no existing KPI card, table, or query is removed or
  changed.
- No test for `LineChart.tsx` or either page component — this project's existing convention (no
  page has a dedicated test); `lib/dashboard-metrics.ts` gets full test coverage since it holds all
  the actual logic (bucketing, scoping).

---

### Task 1: `components/ui/LineChart.tsx`

**Files:**
- Create: `components/ui/LineChart.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `LineChart({ data: {label: string; value: number}[], color?: string, height?: number
  })` — a server component (no `"use client"`). Tasks 3-4 render it with data from Task 2.

- [ ] **Step 1: Write the component**

```tsx
interface LineChartPoint {
  label: string;
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 160,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  const width = 600;
  const padding = 20;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data
    .map((d, i) => `${padding + i * stepX},${height - padding - (d.value / max) * (height - padding * 2)}`)
    .join(" ");

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data[data.length - 1]?.label ?? "";
  const midLabel = data[Math.floor(data.length / 2)]?.label ?? "";

  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} className="w-full h-auto" role="img">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      <text x={padding} y={height + 15} fontSize="10" fill="currentColor" className="text-gray-400">{firstLabel}</text>
      <text x={width / 2} y={height + 15} fontSize="10" textAnchor="middle" fill="currentColor" className="text-gray-400">{midLabel}</text>
      <text x={width - padding} y={height + 15} fontSize="10" textAnchor="end" fill="currentColor" className="text-gray-400">{lastLabel}</text>
    </svg>
  );
}
```

- [ ] **Step 2: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean (this component is not imported anywhere yet, so this only confirms the file
itself is syntactically and structurally valid TSX).

- [ ] **Step 3: Commit**

```bash
git add components/ui/LineChart.tsx
git commit -m "feat: add a dependency-free SVG line chart component"
```

---

### Task 2: `lib/dashboard-metrics.ts`

**Files:**
- Create: `lib/dashboard-metrics.ts`
- Test: `tests/dashboard-metrics.test.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `getDailySignups(from: Date, to: Date): Promise<{label, value}[]>`,
  `getDailyRegistrations(from: Date, to: Date, scope: {organizerId?: string; eventId?: string}):
  Promise<{label, value}[]>`, `getDailyCouponUsage(from: Date, to: Date, scope: {organizerId?:
  string}): Promise<{label, value}[]>` — Tasks 3-4 call all three.

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard-metrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDailySignups, getDailyRegistrations, getDailyCouponUsage } from "@/lib/dashboard-metrics";
import { db } from "@/lib/db";

const dbMock = db as any;

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-03T23:59:59.999Z");

describe("getDailySignups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fills every day in range with zero when there are no rows", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);
    const result = await getDailySignups(from, to);
    expect(result).toEqual([
      { label: "01/01", value: 0 },
      { label: "02/01", value: 0 },
      { label: "03/01", value: 0 },
    ]);
  });

  it("counts multiple rows on the same day and buckets each day correctly", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { createdAt: new Date("2026-01-02T08:00:00.000Z") },
      { createdAt: new Date("2026-01-02T20:00:00.000Z") },
      { createdAt: new Date("2026-01-03T01:00:00.000Z") },
    ]);
    const result = await getDailySignups(from, to);
    expect(result).toEqual([
      { label: "01/01", value: 0 },
      { label: "02/01", value: 2 },
      { label: "03/01", value: 1 },
    ]);
  });
});

describe("getDailyRegistrations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries unscoped when no organizerId/eventId given", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, {});
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    });
  });

  it("scopes by organizerId only", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, { organizerId: "org-1" });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });

  it("scopes by eventId AND organizerId together when both are given", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, { organizerId: "org-1", eventId: "event-1" });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, eventId: "event-1", event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });
});

describe("getDailyCouponUsage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters to orders with a coupon applied, unscoped", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    await getDailyCouponUsage(from, to, {});
    expect(dbMock.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, couponId: { not: null } },
      select: { createdAt: true },
    });
  });

  it("scopes by organizerId", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    await getDailyCouponUsage(from, to, { organizerId: "org-1" });
    expect(dbMock.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, couponId: { not: null }, event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/dashboard-metrics.test.ts`

Expected: FAIL — `@/lib/dashboard-metrics` doesn't exist yet.

- [ ] **Step 3: Write `lib/dashboard-metrics.ts`**

```ts
import { db } from "@/lib/db";

interface DailyPoint {
  label: string;
  value: number;
}

function bucketByDay(dates: Date[], from: Date, to: Date): DailyPoint[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: DailyPoint[] = [];
  for (const cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    const [, month, day] = key.split("-");
    days.push({ label: `${day}/${month}`, value: counts.get(key) ?? 0 });
  }
  return days;
}

export async function getDailySignups(from: Date, to: Date): Promise<DailyPoint[]> {
  const users = await db.user.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true },
  });
  return bucketByDay(users.map((u) => u.createdAt), from, to);
}

export async function getDailyRegistrations(
  from: Date,
  to: Date,
  scope: { organizerId?: string; eventId?: string },
): Promise<DailyPoint[]> {
  const registrations = await db.registration.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(scope.eventId ? { eventId: scope.eventId } : {}),
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(registrations.map((r) => r.createdAt), from, to);
}

export async function getDailyCouponUsage(
  from: Date,
  to: Date,
  scope: { organizerId?: string },
): Promise<DailyPoint[]> {
  const orders = await db.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      couponId: { not: null },
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(orders.map((o) => o.createdAt), from, to);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/dashboard-metrics.test.ts`

Expected: PASS, all 7 tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard-metrics.ts tests/dashboard-metrics.test.ts
git commit -m "feat: add daily-bucketed signup/registration/coupon-usage metrics"
```

---

### Task 3: Wire charts into the admin dashboard

**Files:**
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Consumes: `LineChart` (Task 1), `getDailySignups`/`getDailyRegistrations`/`getDailyCouponUsage`
  (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add imports, `searchParams`, and the date range**

At the top of `app/admin/page.tsx`, replace:

```tsx
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/admin/labels";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [totalUsers, totalEvents, totalOrders, pendingEvents, recentAuditLogs, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, revenue] = await Promise.all([
```

with:

```tsx
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/admin/labels";
import { parseDateInput } from "@/lib/admin/audit";
import { getDailySignups, getDailyRegistrations, getDailyCouponUsage } from "@/lib/dashboard-metrics";
import LineChart from "@/components/ui/LineChart";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  const { de, ate, eventId } = await searchParams;

  const to = parseDateInput(ate, true) ?? new Date();
  const from = parseDateInput(de, false) ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const [totalUsers, totalEvents, totalOrders, pendingEvents, recentAuditLogs, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, revenue] = await Promise.all([
```

- [ ] **Step 2: Fetch the chart data right after the existing `Promise.all`**

Immediately after the existing `Promise.all([...])` call's closing `]);` (the block that resolves
`totalUsers`/`totalEvents`/etc.), insert:

```tsx

  const [signupsData, registrationsData, couponUsageData, events] = await Promise.all([
    getDailySignups(from, to),
    getDailyRegistrations(from, to, { eventId: eventId || undefined }),
    getDailyCouponUsage(from, to, {}),
    db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
```

- [ ] **Step 3: Add the filter form and the three chart cards**

Find this block (the pending-events banner, currently the last thing before "Atividade recente"):

```tsx
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

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Atividade recente</h2>
```

Replace it with (the pending-events banner is unchanged; a filter form and three chart cards are
inserted between it and "Atividade recente"):

```tsx
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

      <form method="GET" className="flex items-center gap-2 text-sm flex-wrap">
        <label className="text-gray-600">De</label>
        <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Até</label>
        <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Evento (inscrições)</label>
        <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
          <option value="">Todos os eventos</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
          <LineChart data={signupsData} color="#7c3aed" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Atividade recente</h2>
```

- [ ] **Step 4: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`

Expected: all tests pass (this task adds no new tests — no page has dedicated tests in this
project — this just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: add signup/registration/coupon-usage charts to the admin dashboard"
```

---

### Task 4: Wire charts into the organizer dashboard

**Files:**
- Modify: `app/organizador/page.tsx`

**Interfaces:**
- Consumes: `LineChart` (Task 1), `getDailyRegistrations`/`getDailyCouponUsage` (Task 2). Does NOT
  use `getDailySignups` — platform-wide signups aren't organizer data.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add imports, `searchParams`, and the date range**

At the top of `app/organizador/page.tsx`, replace:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import { BADGE } from "@/lib/badge-colors";
import PrintButton from "@/components/ui/PrintButton";
import { computeRegistrationStatusBreakdown } from "@/lib/organizer/event-metrics";

export const dynamic = "force-dynamic";
```

with:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import { BADGE } from "@/lib/badge-colors";
import PrintButton from "@/components/ui/PrintButton";
import { computeRegistrationStatusBreakdown } from "@/lib/organizer/event-metrics";
import { parseDateInput } from "@/lib/admin/audit";
import { getDailyRegistrations, getDailyCouponUsage } from "@/lib/dashboard-metrics";
import LineChart from "@/components/ui/LineChart";

export const dynamic = "force-dynamic";
```

(The `EVENT_STATUS` const between these two blocks is unchanged, left in place.)

- [ ] **Step 2: Accept `searchParams` and compute the date range**

Replace:

```tsx
export default async function OrganizerDashboard() {
  const session = await requireOrganizer();

  const organizer = await db.organizerProfile.findUnique({
```

with:

```tsx
export default async function OrganizerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  const session = await requireOrganizer();
  const { de, ate, eventId } = await searchParams;

  const organizer = await db.organizerProfile.findUnique({
```

Then, right after the existing `if (!organizer) { ... }` block (before the `const [eventCount, ...]
= await Promise.all([...])` block), insert:

```tsx

  const to = parseDateInput(ate, true) ?? new Date();
  const from = parseDateInput(de, false) ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
```

- [ ] **Step 3: Fetch the chart data**

Immediately after the existing block that computes `statusCountsByEvent` (the `for (const g of
statusGroups) { ... }` loop) and before the `return (` statement, insert:

```tsx

  const [registrationsData, couponUsageData, chartEvents] = await Promise.all([
    getDailyRegistrations(from, to, { organizerId: organizer.id, eventId: eventId || undefined }),
    getDailyCouponUsage(from, to, { organizerId: organizer.id }),
    db.event.findMany({ where: { organizerId: organizer.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
```

(Named `chartEvents`, not `events`, to avoid colliding with `organizer.events` — the events-with-
orders list already used by the "Meus Eventos" table below.)

- [ ] **Step 4: Add the filter form and the two chart cards**

Find the block right before `<div className="card" id="meus-eventos">` — currently the closing
`</div>` of the second KPI grid (`Inscrições efetivadas`/`pendentes`/`canceladas`):

```tsx
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições canceladas</p>
        </div>
      </div>

      <div className="card" id="meus-eventos">
```

Replace it with:

```tsx
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições canceladas</p>
        </div>
      </div>

      <form method="GET" className="flex items-center gap-2 text-sm flex-wrap">
        <label className="text-gray-600">De</label>
        <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Até</label>
        <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Evento (inscrições)</label>
        <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
          <option value="">Todos os eventos</option>
          {chartEvents.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>

      <div className="card" id="meus-eventos">
```

- [ ] **Step 5: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/organizador/page.tsx
git commit -m "feat: add registration/coupon-usage charts to the organizer dashboard"
```
