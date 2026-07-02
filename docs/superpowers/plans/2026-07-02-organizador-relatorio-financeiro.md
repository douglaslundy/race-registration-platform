# Relatório financeiro do organizador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/organizador/relatorio` page giving organizers their first visibility into revenue (bruta/cancelados/estornos/líquida) and payouts (`TransferPayout`) for their own events, with period + event filters and CSV/PDF export.

**Architecture:** Extract organizer-scoped where-clause logic into pure, unit-testable builder functions in a new `lib/organizer/report.ts` module (mirroring `lib/admin/report.ts` from the previous sub-project, but with `organizerId` mandatory rather than optional since it's a security boundary, not just a filter). Wire those into a new page, a new CSV export route, and one new nav link. No existing page, route, or business logic changes.

**Tech Stack:** Next.js App Router (server components + route handlers), Prisma, Vitest.

## Global Constraints

- Every query must be scoped to the requesting organizer's own data (`organizerId`) — this is a security boundary, not a UX filter. Never expose another organizer's revenue or payouts.
- Revenue must exclude cancelled orders, following the exact pattern already fixed in `lib/admin/report.ts` (`buildReportPaymentWhere`) — gross revenue = payments whose order is still `PAID`.
- Do not modify any existing page, route, or payment/checkout/cancellation/payout mutation logic. This is a new, additive page plus one nav-link edit.
- Follow the existing pure-helper-function + unit-test pattern established in `lib/admin/payments.ts` and `lib/admin/report.ts`.
- Scope is limited to: `lib/organizer/report.ts` (new), `app/organizador/relatorio/page.tsx` (new), `app/api/organizer/report/export/route.ts` (new), `components/organizer/OrganizerNav.tsx`, `lib/admin/labels.ts` (adds `PAYOUT_STATUS_LABEL`), `tests/setup.ts`, plus their tests.
- Commit at the end of every completed task. Never `git push` or deploy without explicit user authorization.
- Run `npx tsc --noEmit` and `npm test` before each commit that touches `.tsx`/`.ts` files.

---

### Task 1: Organizer report where-clause helpers

**Files:**
- Create: `lib/organizer/report.ts`
- Test: `tests/organizer-report-helpers.test.ts`

**Interfaces:**
- Produces: `OrganizerReportFilter { organizerId: string; from: Date; to: Date; eventId?: string }`
- Produces: `buildOrganizerPaymentWhere(filter: OrganizerReportFilter, orderStatus: "PAID" | "CANCELLED"): Prisma.PaymentWhereInput`
- Produces: `buildOrganizerOrderWhere(filter: OrganizerReportFilter, status?: "PAID"): Prisma.OrderWhereInput`
- Produces: `buildOrganizerPayoutWhere(filter: OrganizerReportFilter): Prisma.TransferPayoutWhereInput`

- [ ] **Step 1: Write the failing tests**

Create `tests/organizer-report-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildOrganizerOrderWhere,
  buildOrganizerPaymentWhere,
  buildOrganizerPayoutWhere,
} from "@/lib/organizer/report";

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-31T23:59:59.999Z");
const organizerId = "org-1";

describe("buildOrganizerPaymentWhere", () => {
  it("scopes paid payments to the organizer's paid orders, no event filter", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", event: { organizerId: "org-1" } },
    });
  });

  it("scopes paid payments whose order was cancelled", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to }, "CANCELLED")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "CANCELLED", event: { organizerId: "org-1" } },
    });
  });

  it("adds the event filter to the order sub-clause when eventId is given", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to, eventId: "evt-1" }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", event: { organizerId: "org-1" }, eventId: "evt-1" },
    });
  });
});

describe("buildOrganizerOrderWhere", () => {
  it("scopes by organizer and createdAt range only when no status or event given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to })).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds status when given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to }, "PAID")).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
      status: "PAID",
    });
  });

  it("adds eventId when given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to, eventId: "evt-1" })).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});

describe("buildOrganizerPayoutWhere", () => {
  it("scopes by organizer and createdAt range only when no eventId given", () => {
    expect(buildOrganizerPayoutWhere({ organizerId, from, to })).toEqual({
      organizerId: "org-1",
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds eventId when given", () => {
    expect(buildOrganizerPayoutWhere({ organizerId, from, to, eventId: "evt-1" })).toEqual({
      organizerId: "org-1",
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/organizer-report-helpers.test.ts`
Expected: FAIL with "Cannot find module '@/lib/organizer/report'" (or similar resolution error).

- [ ] **Step 3: Implement `lib/organizer/report.ts`**

```ts
import type { Prisma } from "@prisma/client";

export interface OrganizerReportFilter {
  organizerId: string;
  from: Date;
  to: Date;
  eventId?: string;
}

export function buildOrganizerPaymentWhere(
  filter: OrganizerReportFilter,
  orderStatus: "PAID" | "CANCELLED"
): Prisma.PaymentWhereInput {
  return {
    status: "PAID",
    paidAt: { gte: filter.from, lte: filter.to },
    order: {
      status: orderStatus,
      event: { organizerId: filter.organizerId },
      ...(filter.eventId ? { eventId: filter.eventId } : {}),
    },
  };
}

export function buildOrganizerOrderWhere(
  filter: OrganizerReportFilter,
  status?: "PAID"
): Prisma.OrderWhereInput {
  return {
    event: { organizerId: filter.organizerId },
    createdAt: { gte: filter.from, lte: filter.to },
    ...(status ? { status } : {}),
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}

export function buildOrganizerPayoutWhere(filter: OrganizerReportFilter): Prisma.TransferPayoutWhereInput {
  return {
    organizerId: filter.organizerId,
    createdAt: { gte: filter.from, lte: filter.to },
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/organizer-report-helpers.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/report.ts tests/organizer-report-helpers.test.ts
git commit -m "Feat: helpers de filtro do relatório financeiro do organizador (período/evento/repasse)"
```

---

### Task 2: Build the `/organizador/relatorio` page

**Files:**
- Create: `app/organizador/relatorio/page.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`
- Modify: `lib/admin/labels.ts`
- Modify: `tests/setup.ts`

**Interfaces:**
- Consumes: `buildOrganizerPaymentWhere`, `buildOrganizerOrderWhere`, `buildOrganizerPayoutWhere` from `@/lib/organizer/report` (Task 1).
- Produces: `PAYOUT_STATUS_LABEL` in `lib/admin/labels.ts`, consumed by Task 3 (export route).

- [ ] **Step 1: Add `PAYOUT_STATUS_LABEL` to the shared label map**

In `lib/admin/labels.ts`, add this export at the end of the file (after `ORDER_STATUS_LABEL`):

```ts
export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};
```

- [ ] **Step 2: Add the missing `transferPayout` mock methods**

In `tests/setup.ts`, find this line:

```ts
    transferPayout: { findMany: vi.fn(), count: vi.fn() },
```

Replace it with:

```ts
    transferPayout: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
```

- [ ] **Step 3: Add the "Relatório" nav link**

In `components/organizer/OrganizerNav.tsx`, find the desktop nav block:

```tsx
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
            <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
            <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          </div>
```

Replace it with:

```tsx
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
            <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
            <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
            <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          </div>
```

Then find the mobile nav block:

```tsx
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
          <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
        </div>
```

Replace it with:

```tsx
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
          <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
          <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
        </div>
```

- [ ] **Step 4: Create the page**

Create `app/organizador/relatorio/page.tsx`:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseDateInput } from "@/lib/admin/audit";
import { ORDER_STATUS_LABEL, PAYOUT_STATUS_LABEL } from "@/lib/admin/labels";
import { BADGE } from "@/lib/badge-colors";
import { buildOrganizerOrderWhere, buildOrganizerPaymentWhere, buildOrganizerPayoutWhere } from "@/lib/organizer/report";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";

export const metadata: Metadata = { title: "Relatório Financeiro" };
export const dynamic = "force-dynamic";

const PAYOUT_STATUS_COLOR: Record<string, string> = {
  PENDING: BADGE.yellow,
  PROCESSING: BADGE.blue,
  COMPLETED: BADGE.green,
  FAILED: BADGE.red,
};

const PAYOUT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export default async function OrganizerRelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  const session = await requireOrganizer();
  const { de, ate, eventId } = await searchParams;

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  if (!organizer) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-4">Configure seu perfil de organizador</h1>
        <Link href="/organizador/perfil" className="btn-primary">Configurar perfil</Link>
      </div>
    );
  }

  const from = parseDateInput(de, false) ?? new Date(new Date().getFullYear(), 0, 1);
  const to = parseDateInput(ate, true) ?? new Date();
  to.setHours(23, 59, 59, 999);

  const filter = { organizerId: organizer.id, from, to, eventId: eventId || undefined };

  const [paymentsAgg, cancelledPaymentsAgg, refundsAgg, payoutTotalAgg, payoutsByStatus, payouts, ordersAgg, events] =
    await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildOrganizerPaymentWhere(filter, "PAID"),
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildOrganizerPaymentWhere(filter, "CANCELLED"),
      }),
      db.refund.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: {
          createdAt: { gte: from, lte: to },
          payment: {
            order: {
              event: { organizerId: organizer.id },
              ...(eventId ? { eventId } : {}),
            },
          },
        },
      }),
      db.transferPayout.aggregate({
        _sum: { netAmount: true },
        where: buildOrganizerPayoutWhere(filter),
      }),
      db.transferPayout.groupBy({
        by: ["status"],
        _count: { id: true },
        _sum: { netAmount: true },
        where: buildOrganizerPayoutWhere(filter),
      }),
      db.transferPayout.findMany({
        where: buildOrganizerPayoutWhere(filter),
        orderBy: { createdAt: "desc" },
        include: { event: { select: { title: true } } },
      }),
      db.order.groupBy({
        by: ["status"],
        _count: { id: true },
        _sum: { totalAmount: true },
        where: buildOrganizerOrderWhere(filter),
      }),
      db.event.findMany({
        where: { organizerId: organizer.id },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
    ]);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const payoutNetTotal = payoutTotalAgg._sum.netAmount ?? 0;

  const payoutStatusMap = new Map(
    payoutsByStatus.map((row) => [row.status, { count: row._count.id, net: row._sum.netAmount ?? 0 }])
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Relatório Financeiro</h1>
        <div className="flex flex-wrap items-center gap-2">
          <form method="GET" className="flex items-center gap-2 text-sm">
            <label className="text-gray-600">De</label>
            <input
              type="date"
              name="de"
              defaultValue={de ?? from.toISOString().slice(0, 10)}
              className="input-field py-1 text-sm"
            />
            <label className="text-gray-600">Até</label>
            <input
              type="date"
              name="ate"
              defaultValue={ate ?? to.toISOString().slice(0, 10)}
              className="input-field py-1 text-sm"
            />
            <label className="text-gray-600">Evento</label>
            <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
              <option value="">Todos os eventos</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          </form>
          <Link
            href={`/api/organizer/report/export?de=${from.toISOString().slice(0, 10)}&ate=${to.toISOString().slice(0, 10)}${eventId ? `&eventId=${eventId}` : ""}`}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Exportar CSV
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(grossRevenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita bruta</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-500">{formatCurrency(cancelledAmount)}</p>
          <p className="text-gray-500 text-sm mt-1">Pagamentos cancelados ({cancelledPaymentsAgg._count.id})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-500">-{formatCurrency(refunds)}</p>
          <p className="text-gray-500 text-sm mt-1">Estornos ({refundsAgg._count.id})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(netRevenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita líquida</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(payoutNetTotal)}</p>
          <p className="text-gray-500 text-sm mt-1">Repasse líquido</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Pedidos por status</h2>
        {ordersAgg.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum pedido no período</p>
        ) : (
          <div className="space-y-2">
            {ordersAgg.map((row) => (
              <div key={row.status} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                <span>{ORDER_STATUS_LABEL[row.status] ?? row.status}</span>
                <span>
                  {row._count.id} pedidos · {formatCurrency(row._sum.totalAmount ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Repasses por status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PAYOUT_STATUSES.map((status) => {
            const entry = payoutStatusMap.get(status);
            return (
              <div key={status} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-xl font-bold">{formatCurrency(entry?.net ?? 0)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{PAYOUT_STATUS_LABEL[status]} ({entry?.count ?? 0})</p>
              </div>
            );
          })}
        </div>

        {payouts.length === 0 ? (
          <p className="text-gray-500 text-sm">Nenhum repasse no período</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b dark:border-gray-700">
                  <th className="pb-2 pr-4">Evento</th>
                  <th className="pb-2 pr-4">Bruto</th>
                  <th className="pb-2 pr-4">Taxa</th>
                  <th className="pb-2 pr-4">Líquido</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-4">{p.event.title}</td>
                    <td className="py-2 pr-4">{formatCurrency(p.grossAmount)}</td>
                    <td className="py-2 pr-4">{formatCurrency(p.platformFee)}</td>
                    <td className="py-2 pr-4 font-medium">{formatCurrency(p.netAmount)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${PAYOUT_STATUS_COLOR[p.status] ?? ""}`}>
                        {PAYOUT_STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{formatDate(p.createdAt, "dd/MM/yyyy")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests PASS (including the new ones from Task 1).

- [ ] **Step 7: Commit**

```bash
git add app/organizador/relatorio/page.tsx components/organizer/OrganizerNav.tsx lib/admin/labels.ts tests/setup.ts
git commit -m "Feat: página de relatório financeiro do organizador (receita, cancelados, repasses)"
```

---

### Task 3: CSV export route

**Files:**
- Create: `app/api/organizer/report/export/route.ts`

**Interfaces:**
- Consumes: `buildOrganizerPaymentWhere`, `buildOrganizerPayoutWhere` from `@/lib/organizer/report` (Task 1).

- [ ] **Step 1: Create the export route**

Create `app/api/organizer/report/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";
import { formatCurrency } from "@/lib/format";
import { buildOrganizerPaymentWhere, buildOrganizerPayoutWhere } from "@/lib/organizer/report";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  if (!organizer) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de")?.trim() ?? "";
  const ate = searchParams.get("ate")?.trim() ?? "";
  const eventId = searchParams.get("eventId")?.trim() || undefined;

  const from = parseDateInput(de, false) ?? new Date(new Date().getFullYear(), 0, 1);
  const to = parseDateInput(ate, true) ?? new Date();

  const filter = { organizerId: organizer.id, from, to, eventId };

  const [paymentsAgg, cancelledPaymentsAgg, refundsAgg, payoutTotalAgg] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildOrganizerPaymentWhere(filter, "PAID"),
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildOrganizerPaymentWhere(filter, "CANCELLED"),
    }),
    db.refund.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: {
        createdAt: { gte: from, lte: to },
        payment: {
          order: {
            event: { organizerId: organizer.id },
            ...(eventId ? { eventId } : {}),
          },
        },
      },
    }),
    db.transferPayout.aggregate({
      _sum: { netAmount: true },
      where: buildOrganizerPayoutWhere(filter),
    }),
  ]);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const payoutNetTotal = payoutTotalAgg._sum.netAmount ?? 0;

  const rows: Array<[string, string]> = [
    ["Período", `${from.toISOString()} - ${to.toISOString()}`],
    ["Receita bruta", formatCurrency(grossRevenue)],
    ["Pagamentos cancelados", formatCurrency(cancelledAmount)],
    ["Estornos", formatCurrency(refunds)],
    ["Receita líquida", formatCurrency(netRevenue)],
    ["Repasse líquido", formatCurrency(payoutNetTotal)],
    ["Pagamentos confirmados", String(paymentsAgg._count.id)],
  ];

  const csv = ["Métrica,Valor", ...rows.map(([metric, value]) => `${escapeCsvValue(metric)},${escapeCsvValue(value)}`)].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="relatorio-financeiro-organizador.csv"',
    },
  });
}
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/organizer/report/export/route.ts
git commit -m "Feat: exportação CSV do relatório financeiro do organizador"
```

---

### Task 4: Manual verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server** (or reuse the disposable test environment from previous sub-projects if still available)

Run: `npm run dev`

- [ ] **Step 2: Verify as one organizer**

Log in as an organizer with at least one event that has a paid registration and, ideally, a `TransferPayout` row (seed one via SQL if none exists — see previous sub-projects' verification for the pattern). Navigate to `/organizador/relatorio`. Confirm:
- "Relatório" appears in both the desktop and mobile nav.
- KPI cards show Receita bruta, Pagamentos cancelados, Estornos, Receita líquida, Repasse líquido, all with plausible values.
- "Pedidos por status" and "Repasses por status" sections render correctly, including the per-payout table with Evento/Bruto/Taxa/Líquido/Status/Data.
- The event filter dropdown only lists this organizer's own events (not other organizers').

- [ ] **Step 3: Verify data isolation across organizers**

Log in as a second organizer (or check via the database) and confirm they cannot see the first organizer's revenue or payouts — the page and its `db.organizerProfile.findUnique` + `organizerId` scoping must prevent any cross-organizer leakage.

- [ ] **Step 4: Verify CSV export**

Confirm "Exportar CSV" downloads a file matching the on-screen numbers, respecting the event/date filters.

- [ ] **Step 5: Report results to the user**

Summarize what was checked and any discrepancies found, before considering this plan complete.

---
