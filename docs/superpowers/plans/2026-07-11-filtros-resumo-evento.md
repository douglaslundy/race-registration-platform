# Filtros e resumo na página do evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filters (categoria/percurso/lote/cupom/tipo de pagamento) to the admin and organizer
inscritos lists, and add count+revenue summaries for each of those dimensions to both event pages,
bringing the admin event page to parity with the organizer's.

**Architecture:** Refactor `buildRegistrationWhere` to an options-object signature and add the 5 new
filter clauses. Add two new pure helper functions to `lib/organizer/event-metrics.ts` for the
per-dimension and per-payment-method summaries, fed by two new queries per event page. Export the
existing (currently private) `PAYMENT_METHOD_LABEL` map from `RegistrationsTable.tsx` for reuse.

**Tech Stack:** Next.js App Router (server components), Prisma, Vitest, Tailwind. No new dependencies.

## Global Constraints

- "Pago"/"confirmado" always means `Registration.status === "CONFIRMED"` — this is the existing
  convention (`computeRegistrationStatusBreakdown`), and the new dimension/payment summaries must use
  the same definition so all numbers on the page agree with each other.
- Never use `alert()`/`confirm()`/`prompt()` — not applicable to this plan (no new modals), but any
  existing native dialog in a file this plan touches must be fixed per CLAUDE.md if encountered.
- `paymentMethod` filtering matches ANY payment on the order with that method (`some`), not
  specifically the most recent one — same approximation already used by the existing
  `REFUNDED`/`REFUND_PENDING` status filters in `buildRegistrationWhere`.
- CSV export (`ExportCsvButton`, `/api/events/[id]/registrations`) is explicitly out of scope — it
  ignores all filters today and continues to.

---

### Task 1: Refactor `buildRegistrationWhere` to an options object + new filters

**Files:**
- Modify: `lib/organizer/registrations.ts`
- Test: `tests/organizer-registrations-helpers.test.ts` (full rewrite)

**Interfaces:**
- Produces: `export interface RegistrationFilters { status?: string; q?: string; categoryId?: string; routeId?: string; ticketBatchId?: string; couponId?: string; paymentMethod?: string; }` and `buildRegistrationWhere(eventId: string, filters?: RegistrationFilters): Prisma.RegistrationWhereInput` — used by Task 3 and Task 4. `buildRegistrationOrderBy` is unchanged.

- [ ] **Step 1: Write the failing tests (full rewrite of the test file)**

Replace `tests/organizer-registrations-helpers.test.ts` entirely with:

```ts
import { describe, expect, it } from "vitest";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";

describe("buildRegistrationOrderBy", () => {
  it("defaults to chronological ascending when no params given", () => {
    const result = buildRegistrationOrderBy("", "");
    expect(result).toEqual({ orderBy: { createdAt: "asc" }, normalizedSort: "date", normalizedDir: "asc" });
  });

  it("sorts alphabetically by athlete name", () => {
    const result = buildRegistrationOrderBy("name", "asc");
    expect(result).toEqual({ orderBy: { athlete: { name: "asc" } }, normalizedSort: "name", normalizedDir: "asc" });
  });

  it("sorts chronologically descending", () => {
    const result = buildRegistrationOrderBy("date", "desc");
    expect(result).toEqual({ orderBy: { createdAt: "desc" }, normalizedSort: "date", normalizedDir: "desc" });
  });

  it("treats any non-desc dir as ascending", () => {
    const result = buildRegistrationOrderBy("name", "sideways");
    expect(result.normalizedDir).toBe("asc");
  });
});

describe("buildRegistrationWhere", () => {
  it("filters by eventId only when no filters given", () => {
    expect(buildRegistrationWhere("evt-1")).toEqual({ eventId: "evt-1" });
  });

  it("filters by eventId only when filters object is empty", () => {
    expect(buildRegistrationWhere("evt-1", {})).toEqual({ eventId: "evt-1" });
  });

  it("adds status filter when a valid status is given", () => {
    expect(buildRegistrationWhere("evt-1", { status: "CONFIRMED" })).toEqual({ eventId: "evt-1", status: "CONFIRMED" });
  });

  it("adds status filter for CANCELLATION_REQUESTED", () => {
    expect(buildRegistrationWhere("evt-1", { status: "CANCELLATION_REQUESTED" })).toEqual({
      eventId: "evt-1",
      status: "CANCELLATION_REQUESTED",
    });
  });

  it("filters by refunded/chargeback payment status for REFUNDED", () => {
    expect(buildRegistrationWhere("evt-1", { status: "REFUNDED" })).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] } } } },
    });
  });

  it("ignores invalid status values", () => {
    expect(buildRegistrationWhere("evt-1", { status: "NOT_A_STATUS" })).toEqual({ eventId: "evt-1" });
  });

  it("ignores empty string status", () => {
    expect(buildRegistrationWhere("evt-1", { status: "" })).toEqual({ eventId: "evt-1" });
  });

  it("searches by order id, athlete name and email when q has no digits", () => {
    expect(buildRegistrationWhere("evt-1", { q: "maria" })).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "maria", mode: "insensitive" } },
        { athlete: { name: { contains: "maria", mode: "insensitive" } } },
        { athlete: { email: { contains: "maria", mode: "insensitive" } } },
      ],
    });
  });

  it("also matches athlete CPF when q contains digits", () => {
    expect(buildRegistrationWhere("evt-1", { q: "111.444.777-35" })).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "111.444.777-35", mode: "insensitive" } },
        { athlete: { name: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { email: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { athleteProfile: { cpf: { contains: "11144477735" } } } },
      ],
    });
  });

  it("filters by categoryId", () => {
    expect(buildRegistrationWhere("evt-1", { categoryId: "cat-1" })).toEqual({
      eventId: "evt-1",
      categoryId: "cat-1",
    });
  });

  it("filters by routeId", () => {
    expect(buildRegistrationWhere("evt-1", { routeId: "route-1" })).toEqual({
      eventId: "evt-1",
      routeId: "route-1",
    });
  });

  it("filters by ticketBatchId", () => {
    expect(buildRegistrationWhere("evt-1", { ticketBatchId: "batch-1" })).toEqual({
      eventId: "evt-1",
      ticketBatchId: "batch-1",
    });
  });

  it("filters by couponId via the order relation", () => {
    expect(buildRegistrationWhere("evt-1", { couponId: "coupon-1" })).toEqual({
      eventId: "evt-1",
      order: { couponId: "coupon-1" },
    });
  });

  it("filters by paymentMethod via any payment on the order", () => {
    expect(buildRegistrationWhere("evt-1", { paymentMethod: "PIX" })).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { method: "PIX" } } },
    });
  });

  it("combines multiple filters at once", () => {
    expect(
      buildRegistrationWhere("evt-1", { status: "CONFIRMED", categoryId: "cat-1", routeId: "route-1" }),
    ).toEqual({
      eventId: "evt-1",
      status: "CONFIRMED",
      categoryId: "cat-1",
      routeId: "route-1",
    });
  });

  it("merges couponId and paymentMethod into a single order filter instead of one overwriting the other", () => {
    expect(
      buildRegistrationWhere("evt-1", { couponId: "coupon-1", paymentMethod: "PIX" }),
    ).toEqual({
      eventId: "evt-1",
      order: { couponId: "coupon-1", payments: { some: { method: "PIX" } } },
    });
  });

  it("merges the REFUNDED status's payment condition with paymentMethod into the same payments.some clause", () => {
    expect(
      buildRegistrationWhere("evt-1", { status: "REFUNDED", paymentMethod: "PIX" }),
    ).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] }, method: "PIX" } } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/organizer-registrations-helpers.test.ts`
Expected: FAIL — the old 2-positional-arg calls in the current source don't match the new object-based test expectations (e.g. `buildRegistrationWhere("evt-1", "CONFIRMED")` no longer matches how the new tests call it).

- [ ] **Step 3: Implement the refactor in `lib/organizer/registrations.ts`**

Replace the full file contents with:

```ts
import type { Prisma } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";

export type RegistrationSortColumn = "name" | "date";
export type SortDirection = "asc" | "desc";

const VALID_REGISTRATION_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "TRANSFERRED",
  "WAITLISTED",
  "CANCELLATION_REQUESTED",
];

export function buildRegistrationOrderBy(
  sort: string,
  dir: string
): {
  orderBy: Prisma.RegistrationOrderByWithRelationInput;
  normalizedSort: RegistrationSortColumn;
  normalizedDir: SortDirection;
} {
  const normalizedDir: SortDirection = dir === "desc" ? "desc" : "asc";

  if (sort === "name") {
    return { orderBy: { athlete: { name: normalizedDir } }, normalizedSort: "name", normalizedDir };
  }
  return { orderBy: { createdAt: normalizedDir }, normalizedSort: "date", normalizedDir };
}

export interface RegistrationFilters {
  status?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
}

export function buildRegistrationWhere(
  eventId: string,
  filters: RegistrationFilters = {},
): Prisma.RegistrationWhereInput {
  const { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod } = filters;
  const query = q?.trim();
  const normalizedCpf = query ? normalizeCpf(query) : "";
  const isPaymentStatusFilter = status === "REFUNDED" || status === "REFUND_PENDING";

  // Both couponId and paymentMethod (and the REFUNDED/REFUND_PENDING status filters) live on the
  // related Order/Payment, and Tasks 3-4 let a user pick more than one of these at once — so they
  // must be merged into a single `order` filter object instead of each producing its own spread
  // key, which would let the last one silently overwrite the others.
  const paymentSomeFilter: Prisma.PaymentWhereInput = {};
  if (status === "REFUNDED") {
    paymentSomeFilter.status = { in: ["REFUNDED", "CHARGEBACK"] };
  } else if (status === "REFUND_PENDING") {
    paymentSomeFilter.status = "REFUND_PENDING";
  }
  if (paymentMethod) {
    paymentSomeFilter.method = paymentMethod as never;
  }

  const orderFilter: Prisma.OrderWhereInput = {};
  if (couponId) orderFilter.couponId = couponId;
  if (Object.keys(paymentSomeFilter).length > 0) {
    orderFilter.payments = { some: paymentSomeFilter };
  }

  return {
    eventId,
    ...(!isPaymentStatusFilter && status && VALID_REGISTRATION_STATUSES.includes(status)
      ? { status: status as never }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(routeId ? { routeId } : {}),
    ...(ticketBatchId ? { ticketBatchId } : {}),
    ...(Object.keys(orderFilter).length > 0 ? { order: orderFilter } : {}),
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/organizer-registrations-helpers.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/registrations.ts tests/organizer-registrations-helpers.test.ts
git commit -m "refactor: buildRegistrationWhere takes a filters object, add category/route/batch/coupon/payment-method filters"
```

---

### Task 2: Export `PAYMENT_METHOD_LABEL` from `RegistrationsTable.tsx`

**Files:**
- Modify: `components/registrations/RegistrationsTable.tsx`

**Interfaces:**
- Produces: `export const PAYMENT_METHOD_LABEL: Record<string, string>` — used by Task 3, 4 (filter
  select options) and Task 6, 7 (payment-method summary card).

- [ ] **Step 1: Change the const to an exported const**

In `components/registrations/RegistrationsTable.tsx`, change line 8 from:

```ts
const PAYMENT_METHOD_LABEL: Record<string, string> = {
```

to:

```ts
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
```

No other change to this file — the map's contents (`PIX`, `CREDIT_CARD`, `DEBIT_CARD`, `BOLETO`)
stay exactly as they are.

- [ ] **Step 2: Verify nothing else broke**

Run: `npx vitest run` (full suite — this is a one-line, zero-behavior-change export, but confirm no
existing test imports this file in a way that assumed the const was private).
Expected: PASS, same count as before this task.

- [ ] **Step 3: Commit**

```bash
git add components/registrations/RegistrationsTable.tsx
git commit -m "refactor: export PAYMENT_METHOD_LABEL for reuse in filters and event summaries"
```

---

### Task 3: Filters UI on the organizer inscritos page

**Files:**
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `buildRegistrationWhere(eventId, filters: RegistrationFilters)` (Task 1),
  `PAYMENT_METHOD_LABEL` (Task 2).

- [ ] **Step 1: Extend the event query to fetch categories/routes/batches/coupons for the selects**

In `app/organizador/eventos/[id]/inscritos/page.tsx`, change the event lookup from:

```ts
  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
```

to:

```ts
  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: {
      id: true,
      title: true,
      categories: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      routes: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      ticketBatches: { select: { id: true, name: true }, orderBy: { startAt: "asc" } },
      coupons: { select: { id: true, code: true }, orderBy: { code: "asc" } },
    },
  });
```

- [ ] **Step 2: Extend `SearchParams`, `buildInscritosUrl`, and the filter-clearing condition**

Change the `SearchParams` interface to:

```ts
interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
}
```

Change `buildInscritosUrl`'s parameter type to match (same 5 new optional keys), and its body to
also set each new query param when present:

```ts
function buildInscritosUrl(
  id: string,
  params: {
    status?: string;
    sort?: string;
    dir?: string;
    q?: string;
    categoryId?: string;
    routeId?: string;
    ticketBatchId?: string;
    couponId?: string;
    paymentMethod?: string;
  },
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.q) query.set("q", params.q);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.routeId) query.set("routeId", params.routeId);
  if (params.ticketBatchId) query.set("ticketBatchId", params.ticketBatchId);
  if (params.couponId) query.set("couponId", params.couponId);
  if (params.paymentMethod) query.set("paymentMethod", params.paymentMethod);
  const qs = query.toString();
  return `/organizador/eventos/${id}/inscritos${qs ? `?${qs}` : ""}`;
}
```

- [ ] **Step 3: Read the new params, pass them into `buildRegistrationWhere`, and update the sort links**

Add near the top of the component, alongside the existing `status`/`q` reads:

```ts
  const categoryId = sp.categoryId?.trim() ?? "";
  const routeId = sp.routeId?.trim() ?? "";
  const ticketBatchId = sp.ticketBatchId?.trim() ?? "";
  const couponId = sp.couponId?.trim() ?? "";
  const paymentMethod = sp.paymentMethod?.trim() ?? "";
```

Change the registrations query's `where` from `buildRegistrationWhere(id, status, q)` to:

```ts
    where: buildRegistrationWhere(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod }),
```

Update both `buildInscritosUrl` calls used by the sort toggle links (`Ordem alfabética` /
`Ordem cronológica`) to also pass the 5 new values through, so sorting doesn't drop active filters:

```tsx
        <Link
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
```

- [ ] **Step 4: Add the 5 select inputs to the filter form, and update the "Limpar" condition**

Add the import at the top of the file:

```ts
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
```

Inside the existing `<form method="GET" className="card flex flex-wrap items-end gap-3">`, right
after the "Status" `<div>` block and before the two `<input type="hidden">` lines, add:

```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Categoria</label>
          <select name="categoryId" defaultValue={categoryId} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {event.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Percurso</label>
          <select name="routeId" defaultValue={routeId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Lote</label>
          <select name="ticketBatchId" defaultValue={ticketBatchId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.ticketBatches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Cupom</label>
          <select name="couponId" defaultValue={couponId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.coupons.map((c) => (
              <option key={c.id} value={c.id}>{c.code}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo de pagamento</label>
          <select name="paymentMethod" defaultValue={paymentMethod} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
```

Change the "Limpar" link's visibility condition from:

```tsx
        {status || q ? (
```

to:

```tsx
        {status || q || categoryId || routeId || ticketBatchId || couponId || paymentMethod ? (
```

- [ ] **Step 5: Manual verification (no automated test for this page — matches existing convention, no test file for it today)**

Run: `npm run build` and confirm it compiles cleanly. Since `event.categories`/`event.routes`/
`event.ticketBatches`/`event.coupons` are freshly added to the `select`, double-check the JSX above
only references `.id`/`.name`/`.code` (matching exactly what's selected) so there's no type error
from referencing an unselected field.

- [ ] **Step 6: Commit**

```bash
git add app/organizador/eventos/[id]/inscritos/page.tsx
git commit -m "feat: add category/route/batch/coupon/payment-method filters to organizer inscritos page"
```

---

### Task 4: Filters UI on the admin inscritos page

**Files:**
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Same as Task 3, applied to the admin page. This page has no `organizer: { userId }` scoping
  (admin sees any event's registrations) — do not add one.

- [ ] **Step 1: Extend the event query to fetch categories/routes/batches/coupons for the selects**

In `app/admin/eventos/[id]/inscritos/page.tsx`, change the event lookup from:

```ts
  const event = await db.event.findFirst({
    where: { id },
    select: { id: true, title: true },
  });
```

to:

```ts
  const event = await db.event.findFirst({
    where: { id },
    select: {
      id: true,
      title: true,
      categories: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      routes: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      ticketBatches: { select: { id: true, name: true }, orderBy: { startAt: "asc" } },
      coupons: { select: { id: true, code: true }, orderBy: { code: "asc" } },
    },
  });
```

(Note: unlike the organizer page, this `where` stays `{ id }` — no `organizer: { userId }` scope,
since admin sees any event.)

- [ ] **Step 2: Extend `SearchParams`, `buildInscritosUrl`, and the filter-clearing condition**

Change the `SearchParams` interface to:

```ts
interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
}
```

Change `buildInscritosUrl` to:

```ts
function buildInscritosUrl(
  id: string,
  params: {
    status?: string;
    sort?: string;
    dir?: string;
    q?: string;
    categoryId?: string;
    routeId?: string;
    ticketBatchId?: string;
    couponId?: string;
    paymentMethod?: string;
  },
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.q) query.set("q", params.q);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.routeId) query.set("routeId", params.routeId);
  if (params.ticketBatchId) query.set("ticketBatchId", params.ticketBatchId);
  if (params.couponId) query.set("couponId", params.couponId);
  if (params.paymentMethod) query.set("paymentMethod", params.paymentMethod);
  const qs = query.toString();
  return `/admin/eventos/${id}/inscritos${qs ? `?${qs}` : ""}`;
}
```

- [ ] **Step 3: Read the new params, pass them into `buildRegistrationWhere`, and update the sort links**

Add near the top of the component, alongside the existing `status`/`q` reads:

```ts
  const categoryId = sp.categoryId?.trim() ?? "";
  const routeId = sp.routeId?.trim() ?? "";
  const ticketBatchId = sp.ticketBatchId?.trim() ?? "";
  const couponId = sp.couponId?.trim() ?? "";
  const paymentMethod = sp.paymentMethod?.trim() ?? "";
```

Change the registrations query's `where` from `buildRegistrationWhere(id, status, q)` to:

```ts
    where: buildRegistrationWhere(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod }),
```

Update both `buildInscritosUrl` calls used by the sort toggle links:

```tsx
        <Link
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
```

- [ ] **Step 4: Add the 5 select inputs to the filter form, and update the "Limpar" condition**

Add the import at the top of the file:

```ts
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
```

Inside the existing `<form method="GET" className="card flex flex-wrap items-end gap-3">`, right
after the "Status" `<div>` block and before the two `<input type="hidden">` lines, add:

```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Categoria</label>
          <select name="categoryId" defaultValue={categoryId} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {event.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Percurso</label>
          <select name="routeId" defaultValue={routeId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Lote</label>
          <select name="ticketBatchId" defaultValue={ticketBatchId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.ticketBatches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Cupom</label>
          <select name="couponId" defaultValue={couponId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.coupons.map((c) => (
              <option key={c.id} value={c.id}>{c.code}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo de pagamento</label>
          <select name="paymentMethod" defaultValue={paymentMethod} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
```

Change the "Limpar" link's visibility condition from:

```tsx
        {status || q ? (
```

to:

```tsx
        {status || q || categoryId || routeId || ticketBatchId || couponId || paymentMethod ? (
```

- [ ] **Step 5: Verify**

Run: `npm run build` and confirm it compiles cleanly. Since `event.categories`/`event.routes`/
`event.ticketBatches`/`event.coupons` are freshly added to the `select`, double-check the JSX above
only references `.id`/`.name`/`.code` (matching exactly what's selected) so there's no type error
from referencing an unselected field.

- [ ] **Step 6: Commit**

```bash
git add app/admin/eventos/[id]/inscritos/page.tsx
git commit -m "feat: add category/route/batch/coupon/payment-method filters to admin inscritos page"
```

---

### Task 5: Pure summary helpers — `computeDimensionBreakdowns` + `buildPaymentMethodSummary`

**Files:**
- Modify: `lib/organizer/event-metrics.ts`
- Test: `tests/organizer-event-metrics.test.ts` (extend the existing file — do not replace it, it
  already covers `computeRegistrationStatusBreakdown`/`computeSlotsInfo`)

**Interfaces:**
- Produces:
  - `computeDimensionBreakdowns(registrations: RegistrationForBreakdown[]): { byRoute: Map<string, DimensionStats>; byCategory: Map<string, DimensionStats>; byTicketBatch: Map<string, DimensionStats> }` — used by Task 6, 7.
  - `buildPaymentMethodSummary(groups: { method: string; count: number; revenue: number }[]): PaymentMethodStats[]` — used by Task 6, 7.
  - Types: `DimensionStats { count: number; revenue: number }`, `RegistrationForBreakdown { routeId: string | null; categoryId: string | null; ticketBatchId: string; orderSubtotalAmount: number }`, `PaymentMethodStats { method: string; count: number; revenue: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/organizer-event-metrics.test.ts` (append after the existing `computeSlotsInfo`
`describe` block; add the new import names to the existing import line at the top of the file):

```ts
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";
```

```ts
describe("computeDimensionBreakdowns", () => {
  it("counts and sums revenue per route, category, and ticket batch", () => {
    const result = computeDimensionBreakdowns([
      { routeId: "route-1", categoryId: "cat-1", ticketBatchId: "batch-1", orderSubtotalAmount: 10000 },
      { routeId: "route-1", categoryId: "cat-2", ticketBatchId: "batch-1", orderSubtotalAmount: 15000 },
      { routeId: "route-2", categoryId: "cat-1", ticketBatchId: "batch-2", orderSubtotalAmount: 20000 },
    ]);

    expect(result.byRoute.get("route-1")).toEqual({ count: 2, revenue: 25000 });
    expect(result.byRoute.get("route-2")).toEqual({ count: 1, revenue: 20000 });
    expect(result.byCategory.get("cat-1")).toEqual({ count: 2, revenue: 30000 });
    expect(result.byCategory.get("cat-2")).toEqual({ count: 1, revenue: 15000 });
    expect(result.byTicketBatch.get("batch-1")).toEqual({ count: 2, revenue: 25000 });
    expect(result.byTicketBatch.get("batch-2")).toEqual({ count: 1, revenue: 20000 });
  });

  it("ignores null routeId/categoryId without crashing or adding a null key", () => {
    const result = computeDimensionBreakdowns([
      { routeId: null, categoryId: null, ticketBatchId: "batch-1", orderSubtotalAmount: 5000 },
    ]);

    expect(result.byRoute.size).toBe(0);
    expect(result.byCategory.size).toBe(0);
    expect(result.byTicketBatch.get("batch-1")).toEqual({ count: 1, revenue: 5000 });
  });

  it("returns empty maps for an empty input", () => {
    const result = computeDimensionBreakdowns([]);
    expect(result.byRoute.size).toBe(0);
    expect(result.byCategory.size).toBe(0);
    expect(result.byTicketBatch.size).toBe(0);
  });
});

describe("buildPaymentMethodSummary", () => {
  it("always returns all 4 payment methods in a fixed order", () => {
    const result = buildPaymentMethodSummary([]);
    expect(result.map((r) => r.method)).toEqual(["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"]);
    expect(result.every((r) => r.count === 0 && r.revenue === 0)).toBe(true);
  });

  it("fills in real counts/revenue for methods that appear, zeroing the rest", () => {
    const result = buildPaymentMethodSummary([
      { method: "PIX", count: 10, revenue: 50000 },
      { method: "BOLETO", count: 2, revenue: 8000 },
    ]);

    expect(result).toEqual([
      { method: "PIX", count: 10, revenue: 50000 },
      { method: "CREDIT_CARD", count: 0, revenue: 0 },
      { method: "DEBIT_CARD", count: 0, revenue: 0 },
      { method: "BOLETO", count: 2, revenue: 8000 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/organizer-event-metrics.test.ts`
Expected: FAIL — `computeDimensionBreakdowns`/`buildPaymentMethodSummary` are not exported yet.

- [ ] **Step 3: Implement both functions in `lib/organizer/event-metrics.ts`**

Append to the end of `lib/organizer/event-metrics.ts` (do not modify the existing
`computeRegistrationStatusBreakdown`/`computeSlotsInfo` code above it):

```ts
export interface DimensionStats {
  count: number;
  revenue: number;
}

export interface RegistrationForBreakdown {
  routeId: string | null;
  categoryId: string | null;
  ticketBatchId: string;
  orderSubtotalAmount: number;
}

function accumulate(map: Map<string, DimensionStats>, key: string, amount: number): void {
  const existing = map.get(key) ?? { count: 0, revenue: 0 };
  map.set(key, { count: existing.count + 1, revenue: existing.revenue + amount });
}

export function computeDimensionBreakdowns(registrations: RegistrationForBreakdown[]): {
  byRoute: Map<string, DimensionStats>;
  byCategory: Map<string, DimensionStats>;
  byTicketBatch: Map<string, DimensionStats>;
} {
  const byRoute = new Map<string, DimensionStats>();
  const byCategory = new Map<string, DimensionStats>();
  const byTicketBatch = new Map<string, DimensionStats>();

  for (const r of registrations) {
    if (r.routeId) accumulate(byRoute, r.routeId, r.orderSubtotalAmount);
    if (r.categoryId) accumulate(byCategory, r.categoryId, r.orderSubtotalAmount);
    accumulate(byTicketBatch, r.ticketBatchId, r.orderSubtotalAmount);
  }

  return { byRoute, byCategory, byTicketBatch };
}

const PAYMENT_METHODS = ["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"] as const;

export interface PaymentMethodStats {
  method: string;
  count: number;
  revenue: number;
}

export function buildPaymentMethodSummary(
  groups: { method: string; count: number; revenue: number }[],
): PaymentMethodStats[] {
  const byMethod = new Map(groups.map((g) => [g.method, g]));
  return PAYMENT_METHODS.map((method) => byMethod.get(method) ?? { method, count: 0, revenue: 0 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/organizer-event-metrics.test.ts`
Expected: PASS (all existing tests + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/event-metrics.ts tests/organizer-event-metrics.test.ts
git commit -m "feat: add computeDimensionBreakdowns and buildPaymentMethodSummary helpers"
```

---

### Task 6: Wire dimension + payment-method summaries into the organizer event page

**Files:**
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeDimensionBreakdowns`, `buildPaymentMethodSummary` (Task 5), `PAYMENT_METHOD_LABEL` (Task 2).

- [ ] **Step 1: Add the two new queries**

In `app/organizador/eventos/[id]/page.tsx`, inside the existing `Promise.all([...])` that already
fetches `couponStats` and `statusCounts`, add two more entries:

```ts
  const [couponStats, statusCounts, dimensionRegistrations, paymentGroups] = await Promise.all([
    event.coupons.length > 0
      ? db.order.groupBy({
          by: ["couponId"],
          where: {
            eventId: id,
            couponId: { in: event.coupons.map((c) => c.id) },
            status: "PAID",
          },
          _count: { id: true },
          _sum: { discountAmount: true },
        })
      : Promise.resolve([]),
    db.registration.groupBy({
      by: ["status"],
      where: { eventId: id },
      _count: { id: true },
    }),
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, order: { select: { subtotalAmount: true } } },
    }),
    db.payment.groupBy({
      by: ["method"],
      where: { status: "PAID", order: { eventId: id } },
      _count: { id: true },
      _sum: { amount: true },
    }),
  ]);
```

(This changes the existing `Promise.all` destructuring from 2 to 4 entries — update the array on the
left-hand side exactly as shown, don't create a second `Promise.all`.)

- [ ] **Step 2: Compute the breakdowns right after the existing `statusBreakdown`/`slotsInfo` computation**

Add, right after the existing `const statusBreakdown = computeRegistrationStatusBreakdown(...)` and
`const slotsInfo = computeSlotsInfo(...)` lines:

```ts
  const { byRoute, byCategory, byTicketBatch } = computeDimensionBreakdowns(
    dimensionRegistrations.map((r) => ({
      routeId: r.routeId,
      categoryId: r.categoryId,
      ticketBatchId: r.ticketBatchId,
      orderSubtotalAmount: r.order.subtotalAmount,
    })),
  );
  const paymentMethodSummary = buildPaymentMethodSummary(
    paymentGroups.map((g) => ({ method: g.method, count: g._count.id, revenue: g._sum.amount ?? 0 })),
  );
```

Add the import at the top of the file:

```ts
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
```

- [ ] **Step 3: Update the Percursos card to show count + revenue**

Replace the Percursos card's list body:

```tsx
            <div className="space-y-1">
              {event.routes.map((r) => (
                <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                  <span>{r.name}</span>
                  <span className="text-gray-500">{r.distanceKm}km</span>
                </div>
              ))}
            </div>
```

with:

```tsx
            <div className="space-y-1">
              {event.routes.map((r) => {
                const stats = byRoute.get(r.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                    <span>{r.name} <span className="text-gray-400">({r.distanceKm}km)</span></span>
                    <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
```

- [ ] **Step 4: Update the Categorias card from tags to a count+revenue list**

Replace the Categorias card's list body:

```tsx
            <div className="flex flex-wrap gap-2">
              {event.categories.map((c) => (
                <span key={c.id} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-1 rounded">{c.name}</span>
              ))}
            </div>
```

with:

```tsx
            <div className="space-y-1">
              {event.categories.map((c) => {
                const stats = byCategory.get(c.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={c.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                    <span>{c.name}</span>
                    <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
```

- [ ] **Step 5: Add revenue to the Lotes card**

Replace the Lotes card's list body:

```tsx
            <div className="space-y-2">
              {event.ticketBatches.map((b) => (
                <div key={b.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)}</span>
                </div>
              ))}
            </div>
```

with:

```tsx
            <div className="space-y-2">
              {event.ticketBatches.map((b) => {
                const stats = byTicketBatch.get(b.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={b.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)} · receita: {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
```

- [ ] **Step 6: Add the new "Tipo de pagamento" card**

Add a new card as a 5th entry in the existing `grid grid-cols-1 md:grid-cols-2 gap-6` block (right
after the closing `</div>` of the "Cupons" card, still inside the grid's parent `<div>`):

```tsx
        {/* Tipo de pagamento */}
        <div className="card space-y-3">
          <h2 className="font-semibold">Tipo de pagamento</h2>
          <div className="space-y-1">
            {paymentMethodSummary.map((p) => (
              <div key={p.method} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                <span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                <span className="text-gray-500">{p.count} pagamento{p.count !== 1 ? "s" : ""} · {formatCurrency(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
```

- [ ] **Step 7: Verify**

Run: `npm run build` and confirm it compiles cleanly.

- [ ] **Step 8: Commit**

```bash
git add app/organizador/eventos/[id]/page.tsx
git commit -m "feat: add per-route/category/batch revenue and payment-method summary to organizer event page"
```

---

### Task 7: Wire the same summaries + coupon section into the admin event page

**Files:**
- Modify: `app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Same as Task 6, applied to the admin page, which today lacks the coupon section entirely and has
  no `categories` card at all (only Lotes and Percursos, without counts).

- [ ] **Step 1: Extend the event query**

Change the `event` lookup in `app/admin/eventos/[id]/page.tsx` from:

```ts
  const event = await db.event.findUnique({
    where: { id },
    include: {
      organizer: { include: { user: { select: { id: true, name: true, email: true } } } },
      routes: true,
      categories: true,
      ticketBatches: true,
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });
```

to (add `coupons`, order the relations consistently with the organizer page for readability):

```ts
  const event = await db.event.findUnique({
    where: { id },
    include: {
      organizer: { include: { user: { select: { id: true, name: true, email: true } } } },
      routes: { orderBy: { distanceKm: "asc" } },
      categories: { orderBy: { name: "asc" } },
      ticketBatches: { orderBy: { startAt: "asc" } },
      coupons: { orderBy: { createdAt: "asc" } },
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });
```

- [ ] **Step 2: Add the coupon stats, dimension registrations, and payment-method queries**

The admin page currently fetches `statusCounts` as a separate `await` (not inside a `Promise.all`).
Replace:

```ts
  const statusCounts = await db.registration.groupBy({
    by: ["status"],
    where: { eventId: id },
    _count: { id: true },
  });
```

with:

```ts
  const [couponStats, statusCounts, dimensionRegistrations, paymentGroups] = await Promise.all([
    event.coupons.length > 0
      ? db.order.groupBy({
          by: ["couponId"],
          where: {
            eventId: id,
            couponId: { in: event.coupons.map((c) => c.id) },
            status: "PAID",
          },
          _count: { id: true },
          _sum: { discountAmount: true },
        })
      : Promise.resolve([]),
    db.registration.groupBy({
      by: ["status"],
      where: { eventId: id },
      _count: { id: true },
    }),
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, order: { select: { subtotalAmount: true } } },
    }),
    db.payment.groupBy({
      by: ["method"],
      where: { status: "PAID", order: { eventId: id } },
      _count: { id: true },
      _sum: { amount: true },
    }),
  ]);
```

- [ ] **Step 3: Compute the breakdowns and coupon stats map**

Right after that `Promise.all`, add:

```ts
  const statsMap = new Map(
    couponStats.map((s) => [s.couponId, { uses: s._count.id, discount: s._sum.discountAmount ?? 0 }])
  );
  const totalCouponOrders = couponStats.reduce((s, c) => s + c._count.id, 0);
  const totalDiscount = couponStats.reduce((s, c) => s + (c._sum.discountAmount ?? 0), 0);

  const { byRoute, byCategory, byTicketBatch } = computeDimensionBreakdowns(
    dimensionRegistrations.map((r) => ({
      routeId: r.routeId,
      categoryId: r.categoryId,
      ticketBatchId: r.ticketBatchId,
      orderSubtotalAmount: r.order.subtotalAmount,
    })),
  );
  const paymentMethodSummary = buildPaymentMethodSummary(
    paymentGroups.map((g) => ({ method: g.method, count: g._count.id, revenue: g._sum.amount ?? 0 })),
  );
```

Add imports at the top of the file:

```ts
import {
  computeRegistrationStatusBreakdown,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
import { formatCurrency, formatDate } from "@/lib/format";
```

(`formatCurrency`/`formatDate` are already imported in this file today — merge into the existing
import line rather than duplicating it; `computeRegistrationStatusBreakdown` is also already
imported today, merge it into the same `@/lib/organizer/event-metrics` import line rather than
adding a second one.)

- [ ] **Step 4: Add the Cupons section (copied from the organizer page) right after the existing 3-metric grid**

Insert this block right after the existing `<div className="grid grid-cols-3 gap-4">...</div>`
metrics block and before the "Organizador" card:

```tsx
      {event.coupons.length > 0 && (
        <div className="card space-y-5">
          <h2 className="font-semibold">Uso de cupons</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary-600">{event.coupons.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Cupons criados</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{totalCouponOrders}</p>
              <p className="text-xs text-gray-500 mt-0.5">Pedidos com cupom</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{formatCurrency(totalDiscount)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Desconto concedido</p>
            </div>
          </div>
          <div className="space-y-2">
            {event.coupons.map((c) => {
              const stat = statsMap.get(c.id);
              const uses = stat?.uses ?? 0;
              const discount = stat?.discount ?? 0;
              const maxUses = c.maxUses ?? null;
              const pct = maxUses ? Math.min(100, Math.round((uses / maxUses) * 100)) : null;
              const discountLabel =
                c.discountType === "PERCENT"
                  ? `${c.discountValue}% off`
                  : `${formatCurrency(c.discountValue)} off`;

              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm">{c.code}</span>
                      <span className="text-xs text-gray-500">{discountLabel}</span>
                      {!c.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500">
                          inativo
                        </span>
                      )}
                    </div>
                    {pct !== null && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{pct}%</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-sm font-semibold">
                      {uses} uso{uses !== 1 ? "s" : ""}
                      {maxUses ? ` / ${maxUses}` : ""}
                    </p>
                    {discount > 0 && (
                      <p className="text-xs text-green-700 dark:text-green-400">
                        {formatCurrency(discount)} concedidos
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Replace the existing 2-column Lotes/Percursos grid with a 4-card grid matching the organizer page's layout, adding Categorias and Tipo de pagamento**

Replace:

```tsx
      <div className="grid grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Lotes</h2>
          {event.ticketBatches.map((b) => (
            <div key={b.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{b.name}</span>
              <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)}</span>
            </div>
          ))}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Percursos</h2>
          {event.routes.map((r) => (
            <div key={r.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{r.name}</span>
              <span className="text-gray-500">{r.distanceKm}km</span>
            </div>
          ))}
        </div>
      </div>
```

with:

```tsx
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Lotes</h2>
          {event.ticketBatches.map((b) => {
            const stats = byTicketBatch.get(b.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={b.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{b.name}</span>
                <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)} · receita: {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Percursos</h2>
          {event.routes.map((r) => {
            const stats = byRoute.get(r.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={r.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{r.name} <span className="text-gray-400">({r.distanceKm}km)</span></span>
                <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Categorias</h2>
          {event.categories.map((c) => {
            const stats = byCategory.get(c.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={c.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{c.name}</span>
                <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Tipo de pagamento</h2>
          {paymentMethodSummary.map((p) => (
            <div key={p.method} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
              <span className="text-gray-500">{p.count} pagamento{p.count !== 1 ? "s" : ""} · {formatCurrency(p.revenue)}</span>
            </div>
          ))}
        </div>
      </div>
```

- [ ] **Step 6: Verify**

Run: `npm run build` and confirm it compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add app/admin/eventos/[id]/page.tsx
git commit -m "feat: bring admin event page to parity with organizer (coupons, categories, dimension revenue, payment-method summary)"
```

---

### Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added/changed in Tasks 1 and 5, and every
pre-existing test (baseline going into this plan: 425 tests, per the previous sub-project's final
count).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: succeeds with no type errors, all routes generated including the two modified event pages
and two modified inscritos pages.

- [ ] **Step 3: Confirm the CSV export truly stays unaffected (per Global Constraints)**

Read `components/organizer/ExportCsvButton.tsx` and `app/api/events/[id]/registrations/route.ts`
after all prior tasks are committed — confirm neither file was touched by this plan and neither reads
any of the 5 new filter query params (both should still be exactly as they were before Task 1
started). This is a read-only confirmation, not a code change.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, open an event's inscritos page (admin and organizador) and confirm the 5 new
filter selects render and narrow the list when changed; open the event page for the same event and
confirm the Percursos/Categorias/Lotes cards show numbers and the new "Tipo de pagamento" card
renders.

## Post-plan housekeeping

After Task 8 is verified: mark task #2 in the session task list as completed, update project memory
with what shipped, and move on to task #3 (verificar página de resultados + import CSV) — per the
memory notes, this one already looks built; confirm via investigation before writing a full
spec/plan cycle for it, since it may only need a smoke test.
