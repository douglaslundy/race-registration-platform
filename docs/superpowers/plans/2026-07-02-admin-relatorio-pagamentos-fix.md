# Correção de receita/KPIs no relatório financeiro admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `/admin/relatorio` and `/admin/pagamentos` so cancelled orders no longer count as revenue, add a "Pagamentos cancelados" KPI, replace the platform-fee estimate with the real stored value, add an event filter to the report, and make the payment status filter always list every `PaymentStatus` value.

**Architecture:** Extract the where-clause logic for the report's period/event/order-status filtering into pure, unit-testable builder functions in a new `lib/admin/report.ts` module (mirroring the existing `lib/admin/payments.ts` pattern), then wire those into the report page, its CSV export route, and the payments page.

**Tech Stack:** Next.js App Router (server components + route handlers), Prisma, Vitest.

## Global Constraints

- Revenue must be computed from payments whose **order** is not cancelled — do not change `app/api/registrations/[id]/cancel/route.ts` or any other payment/checkout/cancellation mutation logic. This plan only changes read/aggregation queries.
- Follow the existing pure-helper-function + unit-test pattern established in `lib/admin/payments.ts`.
- Scope is limited to: `lib/admin/report.ts` (new), `app/admin/relatorio/page.tsx`, `app/api/admin/report/export/route.ts`, `app/admin/pagamentos/page.tsx`, their tests, plus `tests/setup.ts` (to add a missing mock method).
- Commit at the end of every completed task. Never `git push` or deploy without explicit user authorization.
- Run `npx tsc --noEmit` and `npm test` before each commit that touches `.tsx`/`.ts` files.

---

### Task 1: Report where-clause helpers

**Files:**
- Create: `lib/admin/report.ts`
- Test: `tests/admin-report-helpers.test.ts`

**Interfaces:**
- Produces: `ReportPeriodFilter { from: Date; to: Date; eventId?: string }`
- Produces: `buildReportPaymentWhere(filter: ReportPeriodFilter, orderStatus: "PAID" | "CANCELLED"): Prisma.PaymentWhereInput`
- Produces: `buildReportOrderWhere(filter: ReportPeriodFilter, status?: "PAID"): Prisma.OrderWhereInput`
- Produces: `buildReportRegistrationWhere(filter: ReportPeriodFilter): Prisma.RegistrationWhereInput`

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-report-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildReportOrderWhere,
  buildReportPaymentWhere,
  buildReportRegistrationWhere,
} from "@/lib/admin/report";

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-31T23:59:59.999Z");

describe("buildReportPaymentWhere", () => {
  it("filters paid payments whose order is still paid, no event filter", () => {
    expect(buildReportPaymentWhere({ from, to }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID" },
    });
  });

  it("filters paid payments whose order was cancelled", () => {
    expect(buildReportPaymentWhere({ from, to }, "CANCELLED")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "CANCELLED" },
    });
  });

  it("adds the event filter to the order sub-clause when eventId is given", () => {
    expect(buildReportPaymentWhere({ from, to, eventId: "evt-1" }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", eventId: "evt-1" },
    });
  });
});

describe("buildReportOrderWhere", () => {
  it("filters by createdAt range only when no status or event given", () => {
    expect(buildReportOrderWhere({ from, to })).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds status when given", () => {
    expect(buildReportOrderWhere({ from, to }, "PAID")).toEqual({
      createdAt: { gte: from, lte: to },
      status: "PAID",
    });
  });

  it("adds eventId when given", () => {
    expect(buildReportOrderWhere({ from, to, eventId: "evt-1" })).toEqual({
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });

  it("combines status and eventId", () => {
    expect(buildReportOrderWhere({ from, to, eventId: "evt-1" }, "PAID")).toEqual({
      createdAt: { gte: from, lte: to },
      status: "PAID",
      eventId: "evt-1",
    });
  });
});

describe("buildReportRegistrationWhere", () => {
  it("filters by createdAt range only when no eventId given", () => {
    expect(buildReportRegistrationWhere({ from, to })).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds eventId when given", () => {
    expect(buildReportRegistrationWhere({ from, to, eventId: "evt-1" })).toEqual({
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/admin-report-helpers.test.ts`
Expected: FAIL with "Cannot find module '@/lib/admin/report'" (or similar resolution error).

- [ ] **Step 3: Implement `lib/admin/report.ts`**

```ts
import type { Prisma } from "@prisma/client";

export interface ReportPeriodFilter {
  from: Date;
  to: Date;
  eventId?: string;
}

export function buildReportPaymentWhere(
  filter: ReportPeriodFilter,
  orderStatus: "PAID" | "CANCELLED"
): Prisma.PaymentWhereInput {
  return {
    status: "PAID",
    paidAt: { gte: filter.from, lte: filter.to },
    order: {
      status: orderStatus,
      ...(filter.eventId ? { eventId: filter.eventId } : {}),
    },
  };
}

export function buildReportOrderWhere(
  filter: ReportPeriodFilter,
  status?: "PAID"
): Prisma.OrderWhereInput {
  return {
    createdAt: { gte: filter.from, lte: filter.to },
    ...(status ? { status } : {}),
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}

export function buildReportRegistrationWhere(filter: ReportPeriodFilter): Prisma.RegistrationWhereInput {
  return {
    createdAt: { gte: filter.from, lte: filter.to },
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/admin-report-helpers.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/admin/report.ts tests/admin-report-helpers.test.ts
git commit -m "Feat: helpers de filtro do relatório financeiro (período/evento/status do pedido)"
```

---

### Task 2: Wire fixes into `/admin/relatorio`

**Files:**
- Modify: `app/admin/relatorio/page.tsx`
- Modify: `tests/setup.ts`

**Interfaces:**
- Consumes: `buildReportPaymentWhere`, `buildReportOrderWhere`, `buildReportRegistrationWhere` from `@/lib/admin/report` (Task 1).

- [ ] **Step 1: Add the missing `order.aggregate` mock**

In `tests/setup.ts`, find this line:

```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
```

Replace it with:

```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

- [ ] **Step 2: Replace the full file content**

Replace `app/admin/relatorio/page.tsx` with:

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { parseDateInput } from "@/lib/admin/audit";
import { ORDER_STATUS_LABEL } from "@/lib/admin/labels";
import { buildReportOrderWhere, buildReportPaymentWhere, buildReportRegistrationWhere } from "@/lib/admin/report";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";

export const metadata: Metadata = { title: "Relatório Financeiro — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminRelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  await requireAdmin();
  const { de, ate, eventId } = await searchParams;

  const from = parseDateInput(de, false) ?? new Date(new Date().getFullYear(), 0, 1);
  const to = parseDateInput(ate, true) ?? new Date();
  to.setHours(23, 59, 59, 999);

  const filter = { from, to, eventId: eventId || undefined };

  const [
    paymentsAgg,
    cancelledPaymentsAgg,
    ordersAgg,
    platformFeeAgg,
    refundsAgg,
    eventCount,
    registrationCount,
    events,
  ] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildReportPaymentWhere(filter, "PAID"),
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildReportPaymentWhere(filter, "CANCELLED"),
    }),
    db.order.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { totalAmount: true },
      where: buildReportOrderWhere(filter),
    }),
    db.order.aggregate({
      _sum: { platformFeeAmount: true },
      where: buildReportOrderWhere(filter, "PAID"),
    }),
    db.refund.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: { createdAt: { gte: from, lte: to } },
    }),
    db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.registration.count({ where: buildReportRegistrationWhere(filter) }),
    db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  const byMethod = await db.payment.groupBy({
    by: ["method"],
    _sum: { amount: true },
    _count: { id: true },
    where: buildReportPaymentWhere(filter, "PAID"),
    orderBy: { _sum: { amount: "desc" } },
  });

  const byMonth = await db.payment.groupBy({
    by: ["paidAt"],
    _sum: { amount: true },
    _count: { id: true },
    where: buildReportPaymentWhere(filter, "PAID"),
  });

  const monthlyMap = new Map<string, number>();
  for (const row of byMonth) {
    if (!row.paidAt) continue;
    const key = `${row.paidAt.getFullYear()}-${String(row.paidAt.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + (row._sum.amount ?? 0));
  }
  const monthly = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const platformFeeActual = platformFeeAgg._sum.platformFeeAmount ?? 0;

  const METHOD_LABEL: Record<string, string> = {
    PIX: "Pix", CREDIT_CARD: "Cartão de Crédito", DEBIT_CARD: "Débito", BOLETO: "Boleto",
  };

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
            href={`/api/admin/report/export?de=${from.toISOString().slice(0, 10)}&ate=${to.toISOString().slice(0, 10)}${eventId ? `&eventId=${eventId}` : ""}`}
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
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(platformFeeActual)}</p>
          <p className="text-gray-500 text-sm mt-1">Taxa da plataforma</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold">{paymentsAgg._count.id}</p>
          <p className="text-gray-500 text-sm">Pagamentos confirmados</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{registrationCount}</p>
          <p className="text-gray-500 text-sm">Inscrições no período</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{eventCount}</p>
          <p className="text-gray-500 text-sm">Eventos criados</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <h2 className="font-semibold">Receita por método de pagamento</h2>
          {byMethod.length === 0 ? (
            <p className="text-gray-500 text-sm">Nenhum dado no período</p>
          ) : (
            <div className="space-y-2">
              {byMethod.map((m) => {
                const pct = grossRevenue > 0 ? Math.round(((m._sum.amount ?? 0) / grossRevenue) * 100) : 0;
                return (
                  <div key={m.method}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{METHOD_LABEL[m.method] ?? m.method}</span>
                      <span className="font-medium">
                        {formatCurrency(m._sum.amount ?? 0)} <span className="text-gray-400">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Pedidos por status</h2>
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
        </div>
      </div>

      {monthly.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Evolução mensal</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b dark:border-gray-700">
                  <th className="pb-2 pr-4">Mês</th>
                  <th className="pb-2 pr-4 text-right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(([month, amount]) => (
                  <tr key={month} className="border-b dark:border-gray-700 last:border-0">
                    <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-300">{month}</td>
                    <td className="py-1.5 pr-4 text-right font-medium">{formatCurrency(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests PASS (including the new ones from Task 1).

- [ ] **Step 5: Commit**

```bash
git add app/admin/relatorio/page.tsx tests/setup.ts
git commit -m "Feat: receita bruta exclui pedidos cancelados, KPI de cancelados, taxa real e filtro por evento no relatório financeiro"
```

---

### Task 3: Wire the same fixes into the CSV export route

**Files:**
- Modify: `app/api/admin/report/export/route.ts`
- Modify: `tests/admin-report-route.test.ts`

**Interfaces:**
- Consumes: `buildReportPaymentWhere`, `buildReportOrderWhere` from `@/lib/admin/report` (Task 1).

- [ ] **Step 1: Replace the full file content**

Replace `app/api/admin/report/export/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";
import { formatCurrency } from "@/lib/format";
import { buildReportOrderWhere, buildReportPaymentWhere, buildReportRegistrationWhere } from "@/lib/admin/report";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de")?.trim() ?? "";
  const ate = searchParams.get("ate")?.trim() ?? "";
  const eventId = searchParams.get("eventId")?.trim() || undefined;

  const from = parseDateInput(de, false) ?? new Date(new Date().getFullYear(), 0, 1);
  const to = parseDateInput(ate, true) ?? new Date();

  const filter = { from, to, eventId };

  const [paymentsAgg, cancelledPaymentsAgg, ordersAgg, platformFeeAgg, refundsAgg, eventCount, registrationCount] =
    await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildReportPaymentWhere(filter, "PAID"),
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildReportPaymentWhere(filter, "CANCELLED"),
      }),
      db.order.groupBy({
        by: ["status"],
        _count: { id: true },
        _sum: { totalAmount: true },
        where: buildReportOrderWhere(filter),
      }),
      db.order.aggregate({
        _sum: { platformFeeAmount: true },
        where: buildReportOrderWhere(filter, "PAID"),
      }),
      db.refund.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: { createdAt: { gte: from, lte: to } },
      }),
      db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
      db.registration.count({ where: buildReportRegistrationWhere(filter) }),
    ]);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const platformFeeActual = platformFeeAgg._sum.platformFeeAmount ?? 0;

  const rows: Array<[string, string]> = [
    ["Período", `${from.toISOString()} - ${to.toISOString()}`],
    ["Receita bruta", formatCurrency(grossRevenue)],
    ["Pagamentos cancelados", formatCurrency(cancelledAmount)],
    ["Estornos", formatCurrency(refunds)],
    ["Receita líquida", formatCurrency(netRevenue)],
    ["Taxa da plataforma", formatCurrency(platformFeeActual)],
    ["Pagamentos confirmados", String(paymentsAgg._count.id)],
    ["Inscrições no período", String(registrationCount)],
    ["Eventos criados", String(eventCount)],
    ["Pedidos PAID", String(ordersAgg.find((row) => row.status === "PAID")?._count.id ?? 0)],
  ];

  const csv = ["Métrica,Valor", ...rows.map(([metric, value]) => `${escapeCsvValue(metric)},${escapeCsvValue(value)}`)].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="relatorio-financeiro.csv"',
    },
  });
}
```

- [ ] **Step 2: Update the existing test to match the new query shape**

Replace `tests/admin-report-route.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/report/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin report export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports the financial summary as csv", async () => {
    dbMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 20000 }, _count: { id: 2 } }) // gross (order PAID)
      .mockResolvedValueOnce({ _sum: { amount: 3000 }, _count: { id: 1 } }); // cancelled (order CANCELLED)
    dbMock.order.groupBy.mockResolvedValueOnce([
      { status: "PAID", _count: { id: 2 }, _sum: { totalAmount: 20000 } },
    ]);
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { platformFeeAmount: 2200 } });
    dbMock.refund.aggregate.mockResolvedValueOnce({
      _sum: { amount: 5000 },
      _count: { id: 1 },
    });
    dbMock.event.count.mockResolvedValueOnce(3);
    dbMock.registration.count.mockResolvedValueOnce(4);

    const res = await GET(
      new Request("http://localhost/api/admin/report/export?de=2026-01-01&ate=2026-01-31", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("relatorio-financeiro.csv");

    const csv = await res.text();
    expect(csv).toContain('"Receita bruta"');
    expect(csv).toMatch(/R\$\s?200,00/);
    expect(csv).toContain('"Pagamentos cancelados"');
    expect(csv).toMatch(/R\$\s?30,00/);
    expect(csv).toContain('"Estornos"');
    expect(csv).toMatch(/R\$\s?50,00/);
    expect(csv).toContain('"Taxa da plataforma"');
    expect(csv).toMatch(/R\$\s?22,00/);
    expect(csv).toContain('"Eventos criados"');
    expect(csv).toContain('"3"');
  });

  it("passes the eventId filter through to the payment and order queries", async () => {
    dbMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } });
    dbMock.order.groupBy.mockResolvedValueOnce([]);
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { platformFeeAmount: 0 } });
    dbMock.refund.aggregate.mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } });
    dbMock.event.count.mockResolvedValueOnce(0);
    dbMock.registration.count.mockResolvedValueOnce(0);

    await GET(
      new Request("http://localhost/api/admin/report/export?de=2026-01-01&ate=2026-01-31&eventId=evt-1", { method: "GET" }) as any,
    );

    expect(dbMock.payment.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ order: expect.objectContaining({ status: "PAID", eventId: "evt-1" }) }),
      }),
    );
    expect(dbMock.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PAID", eventId: "evt-1" }),
      }),
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm test -- tests/admin-report-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/report/export/route.ts tests/admin-report-route.test.ts
git commit -m "Feat: exportação CSV do relatório financeiro reflete cancelados, taxa real e filtro por evento"
```

---

### Task 4: Fix the status filter and total on `/admin/pagamentos`

**Files:**
- Modify: `app/admin/pagamentos/page.tsx`
- Test: `tests/admin-labels.test.ts`

- [ ] **Step 1: Write the failing test for the label map used by the filter**

Create `tests/admin-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PAYMENT_STATUS_LABEL } from "@/lib/admin/labels";

describe("PAYMENT_STATUS_LABEL", () => {
  it("includes every PaymentStatus value the admin filter must offer, including CANCELLED", () => {
    expect(Object.keys(PAYMENT_STATUS_LABEL)).toEqual([
      "PENDING",
      "PAID",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
      "CHARGEBACK",
    ]);
  });
});
```

Run: `npm test -- tests/admin-labels.test.ts`
Expected: PASS immediately — `lib/admin/labels.ts` already defines `PAYMENT_STATUS_LABEL` with exactly these keys (no production code changes needed for this test; it locks in the source of truth the next step reads from).

- [ ] **Step 2: Remove the `distinctStatuses` query and use the full label map instead**

In `app/admin/pagamentos/page.tsx`, find:

```tsx
  const [payments, total, distinctStatuses, distinctMethods] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            buyer: { select: { name: true, email: true } },
            registrations: { select: { event: { select: { title: true } } }, take: 1 },
          },
        },
      },
    }),
    db.payment.count({ where }),
    db.payment.findMany({ select: { status: true }, distinct: ["status"], orderBy: { status: "asc" } }),
    db.payment.findMany({ select: { method: true }, distinct: ["method"], orderBy: { method: "asc" } }),
  ]);
```

Replace it with:

```tsx
  const [payments, total, distinctMethods] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            buyer: { select: { name: true, email: true } },
            registrations: { select: { event: { select: { title: true } } }, take: 1 },
          },
        },
      },
    }),
    db.payment.count({ where }),
    db.payment.findMany({ select: { method: true }, distinct: ["method"], orderBy: { method: "asc" } }),
  ]);
```

- [ ] **Step 3: Fix the "Total pago" aggregate to exclude cancelled orders**

Find:

```tsx
  const totalAmount = await db.payment.aggregate({
    _sum: { amount: true },
    where: { status: "PAID" },
  });
```

Replace it with:

```tsx
  const totalAmount = await db.payment.aggregate({
    _sum: { amount: true },
    where: { status: "PAID", order: { status: "PAID" } },
  });
```

- [ ] **Step 4: Use the full `PAYMENT_STATUS_LABEL` map for the status filter options**

Find:

```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {distinctStatuses.map((row) => (
              <option key={row.status} value={row.status}>
                {PAYMENT_STATUS_LABEL[row.status] ?? row.status}
              </option>
            ))}
          </select>
        </div>
```

Replace it with:

```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npm test`
Expected: All tests PASS (including `tests/admin-labels.test.ts` from Step 1).

- [ ] **Step 6: Commit**

```bash
git add app/admin/pagamentos/page.tsx tests/admin-labels.test.ts
git commit -m "Fix: filtro de status completo e total pago consistente em /admin/pagamentos"
```

---

### Task 5: Manual verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server** (or reuse the disposable test environment from the previous sub-project if still available)

Run: `npm run dev`

- [ ] **Step 2: Verify `/admin/pagamentos`**

Log in as admin. Confirm:
- The Status filter dropdown lists all 6 options (Pendente, Pago, Expirado, Cancelado, Estornado, Chargeback) regardless of what's in the database.
- "Total pago" at the top no longer includes payments whose order was cancelled (compare before/after using a known cancelled+paid registration, e.g. the one created during the previous sub-project's verification).

- [ ] **Step 3: Verify `/admin/relatorio`**

Confirm:
- "Receita bruta" excludes the value of any paid-then-cancelled registration.
- New "Pagamentos cancelados" card shows that same value and count.
- "Taxa da plataforma" shows a real summed value (no longer says "~11%").
- The new "Evento" dropdown filters every card, the payment-method breakdown, "Pedidos por status", and "Evolução mensal" down to the selected event.
- "Exportar CSV" produces a file containing the new "Pagamentos cancelados" row and the updated "Taxa da plataforma" label, and respects the selected event filter.

- [ ] **Step 4: Report results to the user**

Summarize what was checked and any discrepancies found, before considering this plan complete.

---
