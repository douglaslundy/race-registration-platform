import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";
import { formatCurrency } from "@/lib/format";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const de = searchParams.get("de")?.trim() ?? "";
  const ate = searchParams.get("ate")?.trim() ?? "";

  const from = parseDateInput(de, false) ?? new Date(new Date().getFullYear(), 0, 1);
  const to = parseDateInput(ate, true) ?? new Date();

  const [paymentsAgg, ordersAgg, refundsAgg, eventCount, registrationCount] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: { status: "PAID", paidAt: { gte: from, lte: to } },
    }),
    db.order.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { totalAmount: true },
      where: { createdAt: { gte: from, lte: to } },
    }),
    db.refund.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: { createdAt: { gte: from, lte: to } },
    }),
    db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.registration.count({ where: { createdAt: { gte: from, lte: to } } }),
  ]);

  const grossRevenue = paymentsAgg._sum.amount ?? 0;
  const refunds = refundsAgg._sum.amount ?? 0;
  const netRevenue = grossRevenue - refunds;
  const platformFeeEstimate = Math.round(netRevenue * 0.11);

  const rows: Array<[string, string]> = [
    ["Período", `${from.toISOString()} - ${to.toISOString()}`],
    ["Receita bruta", formatCurrency(grossRevenue)],
    ["Estornos", formatCurrency(refunds)],
    ["Receita líquida", formatCurrency(netRevenue)],
    ["Taxa plataforma (~11%)", formatCurrency(platformFeeEstimate)],
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
