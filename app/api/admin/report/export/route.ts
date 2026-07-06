import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";
import { formatCurrency } from "@/lib/format";
import { buildReportOrderWhere, buildReportPaymentWhere, buildReportRegistrationWhere, buildReportRefundWhere } from "@/lib/admin/report";

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
        _sum: { platformFeeAmount: true, paymentFeeAmount: true, subtotalAmount: true },
        where: buildReportOrderWhere(filter, "PAID"),
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: buildReportRefundWhere(filter),
      }),
      db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
      db.registration.count({ where: buildReportRegistrationWhere(filter) }),
    ]);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const cancelledAmount = cancelledPaymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const platformFeeActual = platformFeeAgg._sum.platformFeeAmount ?? 0;
  const serviceFeeActual = platformFeeAgg._sum.paymentFeeAmount ?? 0;
  const eventRevenue = platformFeeAgg._sum.subtotalAmount ?? 0;

  const rows: Array<[string, string]> = [
    ["Período", `${from.toISOString()} - ${to.toISOString()}`],
    ["Receita do evento", formatCurrency(eventRevenue)],
    ["Taxa da plataforma", formatCurrency(platformFeeActual)],
    ["Taxa de serviço", formatCurrency(serviceFeeActual)],
    ["Receita bruta", formatCurrency(grossRevenue)],
    ["Pagamentos cancelados", formatCurrency(cancelledAmount)],
    ["Estornos", formatCurrency(refunds)],
    ["Receita líquida", formatCurrency(netRevenue)],
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
