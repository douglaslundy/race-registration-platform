import { requireAnyPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseDateInput } from "@/lib/admin/audit";
import { ORDER_STATUS_LABEL, PAYOUT_STATUS_LABEL } from "@/lib/admin/labels";
import { BADGE } from "@/lib/badge-colors";
import { buildOrganizerOrderWhere, buildOrganizerOrderFeeWhere, buildOrganizerPaymentWhere, buildOrganizerPayoutWhere, buildOrganizerRefundWhere } from "@/lib/organizer/report";
import { computeRevenueBreakdown } from "@/lib/revenue-breakdown";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";
import ReportKpiLegend from "@/components/ui/ReportKpiLegend";
import RevenueBreakdownCard from "@/components/ui/RevenueBreakdownCard";

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
  const session = await requireAnyPermission(["reports.export"]);
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
  // Não usar to.setHours(...) aqui — parseDateInput(ate, true) já calcula o fim do dia certo em
  // horário de Brasília; setHours mexe na hora LOCAL do servidor (UTC em produção), o que
  // reintroduzia o mesmo tipo de vazamento que este filtro deveria corrigir (~21h a mais no
  // limite "até").
  const to = parseDateInput(ate, true) ?? new Date();

  const filter = { organizerId: organizer.id, from, to, eventId: eventId || undefined };

  const [cancelledPaymentsAgg, refundsAgg, orderFeeAgg, paymentsAgg, payoutTotalAgg, payoutsByStatus, payouts, nonPaidOrdersAgg, events] =
    await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildOrganizerPaymentWhere(filter, "CANCELLED"),
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildOrganizerRefundWhere(filter),
      }),
      db.order.aggregate({
        _count: { id: true },
        _sum: { subtotalAmount: true, totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
        where: buildOrganizerOrderFeeWhere(filter),
      }),
      db.payment.aggregate({
        _sum: { amount: true, gatewayFeeAmount: true },
        where: buildOrganizerPaymentWhere(filter, "PAID"),
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
        where: { ...buildOrganizerOrderWhere(filter), status: { not: "PAID" } },
      }),
      db.event.findMany({
        where: { organizerId: organizer.id },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
    ]);

  const ordersAgg = [
    ...nonPaidOrdersAgg,
    { status: "PAID" as const, _count: { id: orderFeeAgg._count.id }, _sum: { totalAmount: orderFeeAgg._sum.totalAmount } },
  ];

  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const payoutNetTotal = payoutTotalAgg._sum.netAmount ?? 0;
  const revenueBreakdown = computeRevenueBreakdown({
    grossRevenue: paymentsAgg._sum.amount,
    eventRevenue: orderFeeAgg._sum.subtotalAmount,
    platformFeeAmount: orderFeeAgg._sum.platformFeeAmount,
    serviceFeeAmount: orderFeeAgg._sum.paymentFeeAmount,
    gatewayFeeAmount: paymentsAgg._sum.gatewayFeeAmount,
  });

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

      <RevenueBreakdownCard breakdown={revenueBreakdown} variant="organizer" />

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-500">{formatCurrency(cancelledAmount)}</p>
          <p className="text-gray-500 text-sm mt-1">Pagamentos cancelados ({cancelledPaymentsAgg._count.id})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-500">-{formatCurrency(refunds)}</p>
          <p className="text-gray-500 text-sm mt-1">Estornos ({refundsAgg._count.id})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(payoutNetTotal)}</p>
          <p className="text-gray-500 text-sm mt-1">Repasse líquido</p>
        </div>
      </div>

      <ReportKpiLegend hide={["Receita bruta", "Margem real da plataforma"]} />

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
