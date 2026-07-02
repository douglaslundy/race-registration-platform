# KPIs e filtros — página do evento e página de inscritos (organizador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add status-breakdown/remaining-slots KPIs and reposition the coupon-usage block on the organizer event page, and add a status filter + sort toggle + date/time columns on the event registrants page.

**Architecture:** Extract pure, unit-testable calculation/query-builder functions into two new `lib/organizer/*.ts` modules (mirroring the existing `lib/admin/payments.ts` pattern), then wire them into the two existing server-component pages. No new API routes, no schema changes, no changes to payment/checkout/cancellation logic.

**Tech Stack:** Next.js App Router (server components), Prisma, Vitest.

## Global Constraints

- Do not modify any payment, checkout, cancellation, or `soldCount`-mutating logic — this plan is read/display/filter only (per spec "Fora de escopo").
- Follow the existing pure-helper-function + unit-test pattern established in `lib/admin/payments.ts` (see `buildAdminPaymentWhere`/`buildAdminPaymentOrderBy`) for any new filter/sort logic.
- Do not touch any file outside the two pages and their new helper modules/tests listed in this plan.
- Commit at the end of every completed task. Never `git push` or deploy without explicit user authorization.
- Run `npx tsc --noEmit` and `npm test` before each commit that touches `.tsx`/`.ts` files.

---

### Task 1: Event metrics helpers (status breakdown + slots info)

**Files:**
- Create: `lib/organizer/event-metrics.ts`
- Test: `tests/organizer-event-metrics.test.ts`

**Interfaces:**
- Produces: `computeRegistrationStatusBreakdown(counts: { status: string; count: number }[]): { paid: number; pending: number; cancelled: number }`
- Produces: `computeSlotsInfo(input: { maxParticipants: number | null; activeRegistrationsCount: number; batchCapacityTotal: number; batchSoldTotal: number }): { total: number; remaining: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/organizer-event-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeRegistrationStatusBreakdown, computeSlotsInfo } from "@/lib/organizer/event-metrics";

describe("computeRegistrationStatusBreakdown", () => {
  it("maps groupBy counts to paid/pending/cancelled", () => {
    const result = computeRegistrationStatusBreakdown([
      { status: "CONFIRMED", count: 12 },
      { status: "PENDING_PAYMENT", count: 3 },
      { status: "CANCELLED", count: 1 },
    ]);
    expect(result).toEqual({ paid: 12, pending: 3, cancelled: 1 });
  });

  it("defaults missing statuses to zero", () => {
    const result = computeRegistrationStatusBreakdown([{ status: "CONFIRMED", count: 5 }]);
    expect(result).toEqual({ paid: 5, pending: 0, cancelled: 0 });
  });

  it("ignores statuses outside the tracked set", () => {
    const result = computeRegistrationStatusBreakdown([
      { status: "TRANSFERRED", count: 2 },
      { status: "WAITLISTED", count: 4 },
    ]);
    expect(result).toEqual({ paid: 0, pending: 0, cancelled: 0 });
  });
});

describe("computeSlotsInfo", () => {
  it("uses maxParticipants and active registrations when maxParticipants is set", () => {
    const result = computeSlotsInfo({
      maxParticipants: 100,
      activeRegistrationsCount: 40,
      batchCapacityTotal: 999,
      batchSoldTotal: 999,
    });
    expect(result).toEqual({ total: 100, remaining: 60 });
  });

  it("floors remaining at zero when active registrations exceed maxParticipants", () => {
    const result = computeSlotsInfo({
      maxParticipants: 50,
      activeRegistrationsCount: 55,
      batchCapacityTotal: 0,
      batchSoldTotal: 0,
    });
    expect(result).toEqual({ total: 50, remaining: 0 });
  });

  it("falls back to batch capacity/sold totals when maxParticipants is null", () => {
    const result = computeSlotsInfo({
      maxParticipants: null,
      activeRegistrationsCount: 999,
      batchCapacityTotal: 200,
      batchSoldTotal: 120,
    });
    expect(result).toEqual({ total: 200, remaining: 80 });
  });

  it("floors remaining at zero when sold exceeds batch capacity", () => {
    const result = computeSlotsInfo({
      maxParticipants: null,
      activeRegistrationsCount: 0,
      batchCapacityTotal: 100,
      batchSoldTotal: 130,
    });
    expect(result).toEqual({ total: 100, remaining: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/organizer-event-metrics.test.ts`
Expected: FAIL with "Cannot find module '@/lib/organizer/event-metrics'" (or similar resolution error).

- [ ] **Step 3: Implement `lib/organizer/event-metrics.ts`**

```ts
export interface RegistrationStatusCount {
  status: string;
  count: number;
}

export interface RegistrationStatusBreakdown {
  paid: number;
  pending: number;
  cancelled: number;
}

export function computeRegistrationStatusBreakdown(
  counts: RegistrationStatusCount[]
): RegistrationStatusBreakdown {
  const breakdown: RegistrationStatusBreakdown = { paid: 0, pending: 0, cancelled: 0 };
  for (const { status, count } of counts) {
    if (status === "CONFIRMED") breakdown.paid = count;
    else if (status === "PENDING_PAYMENT") breakdown.pending = count;
    else if (status === "CANCELLED") breakdown.cancelled = count;
  }
  return breakdown;
}

export interface SlotsInfoInput {
  maxParticipants: number | null;
  activeRegistrationsCount: number;
  batchCapacityTotal: number;
  batchSoldTotal: number;
}

export interface SlotsInfo {
  total: number;
  remaining: number;
}

export function computeSlotsInfo(input: SlotsInfoInput): SlotsInfo {
  if (input.maxParticipants !== null) {
    return {
      total: input.maxParticipants,
      remaining: Math.max(0, input.maxParticipants - input.activeRegistrationsCount),
    };
  }
  return {
    total: input.batchCapacityTotal,
    remaining: Math.max(0, input.batchCapacityTotal - input.batchSoldTotal),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/organizer-event-metrics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/event-metrics.ts tests/organizer-event-metrics.test.ts
git commit -m "Feat: helpers de KPI de status e vagas restantes do evento"
```

---

### Task 2: Registration query-builder helpers (filter by status, sort)

**Files:**
- Create: `lib/organizer/registrations.ts`
- Test: `tests/organizer-registrations-helpers.test.ts`

**Interfaces:**
- Produces: `buildRegistrationOrderBy(sort: string, dir: string): { orderBy: { athlete: { name: "asc" | "desc" } } | { createdAt: "asc" | "desc" }; normalizedSort: "name" | "date"; normalizedDir: "asc" | "desc" }`
- Produces: `buildRegistrationWhere(eventId: string, status?: string): { eventId: string; status?: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/organizer-registrations-helpers.test.ts`:

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
  it("filters by eventId only when no status given", () => {
    expect(buildRegistrationWhere("evt-1")).toEqual({ eventId: "evt-1" });
  });

  it("adds status filter when a valid status is given", () => {
    expect(buildRegistrationWhere("evt-1", "CONFIRMED")).toEqual({ eventId: "evt-1", status: "CONFIRMED" });
  });

  it("ignores invalid status values", () => {
    expect(buildRegistrationWhere("evt-1", "NOT_A_STATUS")).toEqual({ eventId: "evt-1" });
  });

  it("ignores empty string status", () => {
    expect(buildRegistrationWhere("evt-1", "")).toEqual({ eventId: "evt-1" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/organizer-registrations-helpers.test.ts`
Expected: FAIL with "Cannot find module '@/lib/organizer/registrations'" (or similar resolution error).

- [ ] **Step 3: Implement `lib/organizer/registrations.ts`**

```ts
import type { Prisma } from "@prisma/client";

export type RegistrationSortColumn = "name" | "date";
export type SortDirection = "asc" | "desc";

const VALID_REGISTRATION_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "TRANSFERRED",
  "WAITLISTED",
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

export function buildRegistrationWhere(eventId: string, status?: string): Prisma.RegistrationWhereInput {
  if (status && VALID_REGISTRATION_STATUSES.includes(status)) {
    return { eventId, status: status as never };
  }
  return { eventId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/organizer-registrations-helpers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/registrations.ts tests/organizer-registrations-helpers.test.ts
git commit -m "Feat: helpers de filtro por status e ordenação de inscritos"
```

---

### Task 3: Wire KPIs into the organizer event detail page

**Files:**
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeRegistrationStatusBreakdown` and `computeSlotsInfo` from `@/lib/organizer/event-metrics` (Task 1).

- [ ] **Step 1: Replace the full file content**

Replace `app/organizador/eventos/[id]/page.tsx` with:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import PublishEventButton from "@/components/organizer/PublishEventButton";
import DuplicateEventButton from "@/components/organizer/DuplicateEventButton";
import ArchiveEventButton from "@/components/organizer/ArchiveEventButton";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import PrintButton from "@/components/ui/PrintButton";
import type { Metadata } from "next";
import { computeRegistrationStatusBreakdown, computeSlotsInfo } from "@/lib/organizer/event-metrics";

export const metadata: Metadata = { title: "Gerenciar Evento" };
export const dynamic = "force-dynamic";

import { BADGE } from "@/lib/badge-colors";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT:                { label: "Rascunho", color: BADGE.gray },
  UNDER_REVIEW:         { label: "Em análise", color: BADGE.yellow },
  PUBLISHED:            { label: "Publicado", color: BADGE.blue },
  REGISTRATIONS_OPEN:   { label: "Inscrições abertas", color: BADGE.green },
  SOLD_OUT:             { label: "Esgotado", color: BADGE.orange },
  REGISTRATIONS_CLOSED: { label: "Inscrições encerradas", color: BADGE.gray },
  COMPLETED:            { label: "Concluído", color: BADGE.green },
  CANCELLED:            { label: "Cancelado", color: BADGE.red },
};

export default async function OrganizerEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    include: {
      routes: { orderBy: { distanceKm: "asc" } },
      categories: { orderBy: { name: "asc" } },
      ticketBatches: { orderBy: { startAt: "asc" } },
      coupons: { orderBy: { createdAt: "asc" } },
      _count: { select: { registrations: true } },
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });

  if (!event) notFound();

  // Coupon usage stats grouped by couponId, plus registration status breakdown
  const [couponStats, statusCounts] = await Promise.all([
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
  ]);

  const statsMap = new Map(
    couponStats.map((s) => [s.couponId, { uses: s._count.id, discount: s._sum.discountAmount ?? 0 }])
  );

  const totalCouponOrders = couponStats.reduce((s, c) => s + c._count.id, 0);
  const totalDiscount = couponStats.reduce((s, c) => s + (c._sum.discountAmount ?? 0), 0);

  const statusBreakdown = computeRegistrationStatusBreakdown(
    statusCounts.map((s) => ({ status: s.status, count: s._count.id }))
  );

  const slotsInfo = computeSlotsInfo({
    maxParticipants: event.maxParticipants,
    activeRegistrationsCount: statusBreakdown.paid + statusBreakdown.pending,
    batchCapacityTotal: event.ticketBatches.reduce((s, b) => s + b.capacity, 0),
    batchSoldTotal: event.ticketBatches.reduce((s, b) => s + b.soldCount, 0),
  });

  const revenue = event.orders.reduce((s, o) => s + o.totalAmount, 0);
  const statusInfo = STATUS_LABEL[event.status] ?? STATUS_LABEL.DRAFT;
  const canPublish = event.status === "DRAFT";
  const canDelete = ["DRAFT", "CANCELLED"].includes(event.status);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/organizador" className="hover:text-primary-600">← Dashboard</Link>
          </div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <span className="text-sm text-gray-500">{formatDate(event.startAt)}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
          <Link href={`/organizador/eventos/${id}/editar`} className="btn-secondary text-sm">
            Editar evento
          </Link>
          {canPublish && <PublishEventButton eventId={id} />}
          <DuplicateEventButton eventId={id} />
          {!["COMPLETED", "CANCELLED"].includes(event.status) && <ArchiveEventButton eventId={id} />}
          {canDelete && <DeleteEventButton eventId={id} />}
          <PrintButton label="PDF" />
          <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
            Ver página →
          </Link>
        </div>
      </div>

      {/* Métricas gerais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{event._count.registrations}</p>
          <p className="text-gray-500 text-sm mt-1">Inscrições</p>
          <p className="text-xs text-gray-400 mt-1">
            {statusBreakdown.paid} pagas · {statusBreakdown.pending} pendentes · {statusBreakdown.cancelled} canceladas
          </p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{formatCurrency(revenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita (pago)</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{slotsInfo.total}</p>
          <p className="text-gray-500 text-sm mt-1">Vagas totais</p>
          <p className="text-xs text-gray-400 mt-1">restantes: {slotsInfo.remaining}</p>
        </div>
      </div>

      {/* Relatório de cupons — visão geral + agrupado por cupom */}
      {event.coupons.length > 0 && (
        <div className="card space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Uso de cupons</h2>
            <Link
              href={`/organizador/eventos/${id}/cupons/relatorio`}
              className="text-xs text-primary-600 hover:underline"
            >
              Ver relatório completo →
            </Link>
          </div>

          {/* Visão geral */}
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

          {/* Agrupado por cupom */}
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
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
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

      {/* Grade: Lotes / Percursos / Categorias / Cupons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lotes */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Lotes de inscrição</h2>
            <Link href={`/organizador/eventos/${id}/lotes`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.ticketBatches.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum lote criado</p>
          ) : (
            <div className="space-y-2">
              {event.ticketBatches.map((b) => (
                <div key={b.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Percursos */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Percursos</h2>
            <Link href={`/organizador/eventos/${id}/percursos`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.routes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum percurso cadastrado</p>
          ) : (
            <div className="space-y-1">
              {event.routes.map((r) => (
                <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                  <span>{r.name}</span>
                  <span className="text-gray-500">{r.distanceKm}km</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categorias */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Categorias</h2>
            <Link href={`/organizador/eventos/${id}/categorias`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.categories.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma categoria cadastrada</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {event.categories.map((c) => (
                <span key={c.id} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-1 rounded">{c.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Cupons — card compacto */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Cupons de desconto</h2>
            <Link href={`/organizador/eventos/${id}/cupons`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.coupons.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum cupom criado</p>
          ) : (
            <div className="space-y-1">
              {event.coupons.map((c) => (
                <div key={c.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                  <span className="font-mono font-medium">{c.code}</span>
                  <span className="text-gray-500">
                    {c.discountType === "PERCENT" ? `${c.discountValue}%` : formatCurrency(c.discountValue)}
                    {" · "}{c.usedCount}/{c.maxUses ?? "∞"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <Link href={`/organizador/eventos/${id}/inscritos`} className="btn-secondary flex-1 text-center">
          Ver inscritos
        </Link>
        <Link href={`/organizador/eventos/${id}/resultados`} className="btn-secondary flex-1 text-center">
          Importar resultados
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests PASS (including the new ones from Task 1).

- [ ] **Step 4: Commit**

```bash
git add app/organizador/eventos/\[id\]/page.tsx
git commit -m "Feat: KPIs de status/vagas restantes e reposição do bloco de cupons na página do evento"
```

---

### Task 4: Filter, sort, and date/time columns on the registrants page

**Files:**
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `buildRegistrationOrderBy` and `buildRegistrationWhere` from `@/lib/organizer/registrations` (Task 2).

- [ ] **Step 1: Replace the full file content**

Replace `app/organizador/eventos/[id]/inscritos/page.tsx` with:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import PrintButton from "@/components/ui/PrintButton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
}

function buildInscritosUrl(id: string, params: { status?: string; sort?: string; dir?: string }) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  const qs = query.toString();
  return `/organizador/eventos/${id}/inscritos${qs ? `?${qs}` : ""}`;
}

export default async function InscritosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrganizer();
  const { id } = await params;
  const sp = await searchParams;
  const status = sp.status?.trim() ?? "";
  const sortConfig = buildRegistrationOrderBy(sp.sort?.trim() ?? "", sp.dir?.trim() ?? "");

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: buildRegistrationWhere(id, status),
    include: {
      athlete: { select: { name: true, email: true } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: {
        select: {
          totalAmount: true,
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true },
          },
        },
      },
    },
    orderBy: sortConfig.orderBy,
  });

  const nameDir = sortConfig.normalizedSort === "name" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const dateDir = sortConfig.normalizedSort === "date" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const activeButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-primary-500 text-primary-600";
  const inactiveButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton eventId={id} />
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      <form method="GET" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        {status ? (
          <Link
            href={buildInscritosUrl(id, { sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir })}
            className="btn-secondary py-1.5 px-4 text-sm"
          >
            Limpar
          </Link>
        ) : null}
      </form>

      <div className="flex gap-2">
        <Link
          href={buildInscritosUrl(id, { status, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-4">Atleta</th>
                <th className="pb-2 pr-4">Percurso</th>
                <th className="pb-2 pr-4">Categoria</th>
                <th className="pb-2 pr-4">Lote</th>
                <th className="pb-2 pr-4">Camiseta</th>
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => {
                const payment = r.order.payments[0];
                const statusInfo = REGISTRATION_STATUS[r.status];
                return (
                  <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="py-2 pr-4">
                      <p className="font-medium">{r.athlete.name}</p>
                      <p className="text-xs text-gray-500">{r.athlete.email}</p>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{r.route?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.category?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.ticketBatch.name}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.shirtSize ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatCurrency(r.order.totalAmount)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                        {statusInfo?.label ?? r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/organizador/eventos/\[id\]/inscritos/page.tsx
git commit -m "Feat: filtro por status, ordenação e colunas de data/hora na página de inscritos"
```

---

### Task 5: Manual verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the event detail page**

Navigate to `/organizador/eventos/<id-de-um-evento-com-inscricoes-e-cupons>` for a seeded/test event owned by the logged-in organizer. Confirm:
- "Inscrições" card shows the total plus a line "X pagas · Y pendentes · Z canceladas" that adds up to the total (or to totals across all statuses if `TRANSFERRED`/`WAITLISTED` exist).
- "Vagas totais" card shows "restantes: N". Test both an event with `maxParticipants` set and one left blank (0 in the form) to see both branches.
- "Uso de cupons" block appears directly under the 3-KPI row, above the Lotes/Percursos/Categorias/Cupons grid.

- [ ] **Step 3: Verify the registrants page**

Navigate to `/organizador/eventos/<id>/inscritos`. Confirm:
- Status filter dropdown narrows the list and the "N inscrições" counter updates.
- "Ordem alfabética" and "Ordem cronológica" buttons toggle asc/desc (arrow flips) and reorder rows; the currently active button is visually highlighted.
- "Data pag." shows time; new "Data inscrição" column shows date + time.
- Filter and sort combine correctly (e.g., filter by "Confirmada" then sort alphabetically).

- [ ] **Step 4: Report results to the user**

Summarize what was checked and any discrepancies found, before considering this plan complete.

---
