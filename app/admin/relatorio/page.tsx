import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { parseDateInput } from "@/lib/admin/audit";
import { ORDER_STATUS_LABEL } from "@/lib/admin/labels";
import { buildReportOrderWhere, buildReportOrderFeeWhere, buildReportPaymentWhere, buildReportRegistrationWhere, buildReportRefundWhere } from "@/lib/admin/report";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";
import ReportKpiLegend from "@/components/ui/ReportKpiLegend";

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
    nonPaidOrdersAgg,
    paidOrdersAgg,
    platformFeeAgg,
    refundsAgg,
    eventCount,
    registrationCount,
    events,
  ] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true, gatewayFeeAmount: true },
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
      where: { ...buildReportOrderWhere(filter), status: { not: "PAID" } },
    }),
    db.order.aggregate({
      _count: { id: true },
      _sum: { totalAmount: true },
      where: buildReportOrderFeeWhere(filter),
    }),
    db.order.aggregate({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true, subtotalAmount: true },
      where: buildReportOrderFeeWhere(filter),
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildReportRefundWhere(filter),
    }),
    db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.registration.count({ where: buildReportRegistrationWhere(filter) }),
    db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  const ordersAgg = [
    ...nonPaidOrdersAgg,
    { status: "PAID" as const, _count: { id: paidOrdersAgg._count.id }, _sum: { totalAmount: paidOrdersAgg._sum.totalAmount } },
  ];

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
  const serviceFeeActual = platformFeeAgg._sum.paymentFeeAmount ?? 0;
  const eventRevenue = platformFeeAgg._sum.subtotalAmount ?? 0;
  const gatewayFeeActual = paymentsAgg._sum.gatewayFeeAmount ?? 0;

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-teal-600">{formatCurrency(eventRevenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita do evento</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(platformFeeActual)}</p>
          <p className="text-gray-500 text-sm mt-1">Taxa da plataforma</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(serviceFeeActual)}</p>
          <p className="text-gray-500 text-sm mt-1">Taxa de serviço</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(gatewayFeeActual)}</p>
          <p className="text-gray-500 text-sm mt-1">Comissão do gateway</p>
        </div>
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
      </div>

      <ReportKpiLegend />

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
