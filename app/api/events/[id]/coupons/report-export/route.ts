import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
    select: { id: true, title: true },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const coupons = await db.coupon.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, discountType: true, discountValue: true, maxUses: true, expiresAt: true },
  });

  const couponIds = coupons.map((c) => c.id);

  const orders = couponIds.length
    ? await db.order.findMany({
        where: { eventId: id, couponId: { in: couponIds }, status: "PAID" },
        select: {
          id: true,
          couponId: true,
          discountAmount: true,
          totalAmount: true,
          createdAt: true,
          buyer: { select: { name: true, email: true } },
          registrations: {
            take: 1,
            select: {
              route: { select: { name: true } },
              category: { select: { name: true } },
              ticketBatch: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const couponMap = new Map(coupons.map((c) => [c.id, c]));

  const header = "Cupom,Tipo,Desconto,Atleta,E-mail,Lote,Percurso / Categoria,Desconto aplicado (R$),Total pago (R$),Data do pedido\n";

  const rows = orders.map((o) => {
    const coupon = couponMap.get(o.couponId ?? "");
    const reg = o.registrations[0];
    const discountLabel =
      coupon?.discountType === "PERCENT"
        ? `${coupon.discountValue}%`
        : (coupon ? (coupon.discountValue / 100).toFixed(2) : "");
    const routeCategory = [reg?.route?.name, reg?.category?.name].filter(Boolean).join(" / ");

    return [
      coupon?.code ?? "",
      coupon?.discountType === "PERCENT" ? "Percentual" : "Valor fixo",
      discountLabel,
      o.buyer.name,
      o.buyer.email,
      reg?.ticketBatch.name ?? "",
      routeCategory,
      (o.discountAmount / 100).toFixed(2),
      (o.totalAmount / 100).toFixed(2),
      o.createdAt.toISOString().slice(0, 10),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });

  const eventSlug = event.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);

  return new NextResponse(header + rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cupons-relatorio-${eventSlug}.csv"`,
    },
  });
}
