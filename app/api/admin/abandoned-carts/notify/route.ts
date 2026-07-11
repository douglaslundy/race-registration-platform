import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { buildAbandonedCartWhere } from "@/lib/alerts/abandoned-cart-query";

const ORDER_SELECT = {
  id: true,
  buyerUserId: true,
  event: { select: { title: true } },
  buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
} as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const settings = await getAbandonedCartAlertSettings();

  let orders;
  if (body.orderId) {
    const order = await db.order.findFirst({
      where: { id: body.orderId, status: "PENDING" },
      select: ORDER_SELECT,
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    orders = [order];
  } else if (body.all) {
    const where = buildAbandonedCartWhere({ q: body.q, event: body.event, dateFrom: body.dateFrom, dateTo: body.dateTo });
    orders = await db.order.findMany({ where, select: ORDER_SELECT });
  } else {
    return NextResponse.json({ error: "Informe orderId ou all" }, { status: 400 });
  }

  let notified = 0;
  for (const order of orders) {
    try {
      const { sent } = await sendAbandonedCartAlert(order, settings, { bypassDedupe: true });
      if (sent) {
        notified++;
        await db.auditLog.create({
          data: {
            userId: session.user.id,
            action: "ABANDONED_CART_NOTIFICATION_RESENT",
            entityType: "Order",
            entityId: order.id,
            metadata: { eventTitle: order.event.title },
          },
        });
      }
    } catch (err) {
      console.error("[admin-abandoned-carts-notify] failed for order", order.id, err);
    }
  }

  return NextResponse.json({ notified, total: orders.length });
}
