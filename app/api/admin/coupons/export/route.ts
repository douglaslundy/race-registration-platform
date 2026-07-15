import { NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/events";

export async function GET() {
  const check = await checkAdminOnlyApiPermission("coupons.export-all");
  if (!check.allowed) return check.response;

  const [coupons, usage] = await Promise.all([
    db.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { title: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    db.order.groupBy({
      by: ["couponId"],
      where: { couponId: { not: null }, status: "PAID" },
      _sum: { discountAmount: true },
      _count: { _all: true },
    }),
  ]);

  const usageMap = new Map(
    usage.map((u) => [u.couponId as string, { discount: u._sum.discountAmount ?? 0, count: u._count._all }])
  );

  const header = ["Código", "Tipo", "Desconto", "Evento", "Criado por", "Usos", "Máx. usos", "Desconto concedido (R$)", "Expira em", "Ativo"]
    .map(escapeCsvValue)
    .join(",") + "\n";

  const rows = coupons
    .map((c) => {
      const u = usageMap.get(c.id);
      const discountLabel = c.discountType === "PERCENT" ? `${c.discountValue}%` : `R$ ${(c.discountValue / 100).toFixed(2)}`;
      return [
        c.code,
        c.discountType === "PERCENT" ? "Percentual" : "Valor fixo",
        discountLabel,
        c.event?.title ?? "Global",
        c.createdBy?.name ?? "",
        u?.count ?? 0,
        c.maxUses ?? "ilimitado",
        ((u?.discount ?? 0) / 100).toFixed(2),
        c.expiresAt ? c.expiresAt.toLocaleDateString("pt-BR") : "",
        c.active ? "Sim" : "Não",
      ]
        .map(escapeCsvValue)
        .join(",");
    })
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cupons.csv"',
    },
  });
}
