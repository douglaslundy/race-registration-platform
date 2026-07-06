import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";
import { formatCurrency } from "@/lib/format";
import { buildOrganizerOrderWhere, buildOrganizerOrderFeeWhere, buildOrganizerPaymentWhere, buildOrganizerPayoutWhere, buildOrganizerRefundWhere } from "@/lib/organizer/report";

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

  const [paymentsAgg, cancelledPaymentsAgg, refundsAgg, orderFeeAgg, payoutTotalAgg] = await Promise.all([
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
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: buildOrganizerRefundWhere(filter),
    }),
    db.order.aggregate({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true, subtotalAmount: true },
      where: buildOrganizerOrderFeeWhere(filter),
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
  const platformFeeActual = orderFeeAgg._sum.platformFeeAmount ?? 0;
  const serviceFeeActual = orderFeeAgg._sum.paymentFeeAmount ?? 0;
  const eventRevenue = orderFeeAgg._sum.subtotalAmount ?? 0;

  const rows: Array<[string, string]> = [
    ["Período", `${from.toISOString()} - ${to.toISOString()}`],
    ["Receita do evento", formatCurrency(eventRevenue)],
    ["Taxa da plataforma", formatCurrency(platformFeeActual)],
    ["Taxa de serviço", formatCurrency(serviceFeeActual)],
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
