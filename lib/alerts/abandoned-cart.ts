import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, recordAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export interface AbandonedOrder {
  id: string;
  buyerUserId: string;
  event: { title: string };
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
}

export async function sendAbandonedCartAlert(
  order: AbandonedOrder,
  settings: { emailEnabled: boolean; whatsappEnabled: boolean },
  options?: { bypassDedupe?: boolean },
): Promise<{ sent: boolean }> {
  const bypassDedupe = options?.bypassDedupe ?? false;

  let sentSomething = false;

  if (settings.emailEnabled) {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg) && (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL")))) {
      try {
        await sendAbandonedCartEmail({
          to: order.buyer.email,
          name: order.buyer.name,
          eventTitle: order.event.title,
          orderId: order.id,
        });
        if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", order.id, "EMAIL");
        sentSomething = true;
      } catch (err) {
        if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
        throw err;
      }
    }
  }

  if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
    if (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP"))) {
      try {
        await sendWhatsAppMessage(
          order.buyer.athleteProfile.phone,
          `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
        );
        if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP");
        sentSomething = true;
      } catch (err) {
        if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
        throw err;
      }
    }
  }

  // Só grava auditoria quando um aviso real foi enviado — sem isso, checkAbandonedCarts()
  // reprocessando o mesmo pedido PENDING a cada ciclo de cron gerava uma linha nova por execução,
  // pra sempre, mesmo quando o dedupe já tinha bloqueado ambos os canais (nada de novo aconteceu).
  if (sentSomething) {
    await db.auditLog.create({
      data: {
        userId: order.buyerUserId,
        action: "CART_ABANDONED",
        entityType: "Order",
        entityId: order.id,
        metadata: { eventTitle: order.event.title },
      },
    });
  }

  return { sent: sentSomething };
}

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      buyerUserId: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      const { sent } = await sendAbandonedCartAlert(order, settings);
      if (sent) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
