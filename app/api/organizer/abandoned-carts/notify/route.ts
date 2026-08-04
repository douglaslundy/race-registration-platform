import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { buildAbandonedCartWhere } from "@/lib/alerts/abandoned-cart-query";

const ORDER_SELECT = {
  id: true,
  buyerUserId: true,
  event: { select: { id: true, title: true } },
  buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
} as const;

export async function POST(req: NextRequest) {
  const check = await checkApiPermission("abandoned-carts.notify");
  if (!check.allowed) return check.response;
  const { session } = check;

  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }

  const body = await req.json().catch(() => ({}));
  const settings = await getAbandonedCartAlertSettings();
  const scope = { organizerUserId };

  let orders;
  if (body.orderId) {
    const order = await db.order.findFirst({
      where: { id: body.orderId, status: "PENDING", event: { organizer: { userId: organizerUserId } } },
      select: ORDER_SELECT,
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    orders = [order];
  } else if (body.all) {
    const where = buildAbandonedCartWhere(
      { q: body.q, event: body.event, dateFrom: body.dateFrom, dateTo: body.dateTo },
      scope,
    );
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
      console.error("[organizer-abandoned-carts-notify] failed for order", order.id, err);
    }
  }

  return NextResponse.json({ notified, total: orders.length });
}
