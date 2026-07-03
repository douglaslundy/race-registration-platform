import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

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
      await db.auditLog.create({
        data: {
          userId: order.buyerUserId,
          action: "CART_ABANDONED",
          entityType: "Order",
          entityId: order.id,
          metadata: { eventTitle: order.event.title },
        },
      });

      let sentSomething = false;

      if (settings.emailEnabled) {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg) && (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL"))) {
          try {
            await sendAbandonedCartEmail({
              to: order.buyer.email,
              name: order.buyer.name,
              eventTitle: order.event.title,
              orderId: order.id,
            });
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
            throw err;
          }
        }
      }

      if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
        if (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP")) {
          try {
            await sendWhatsAppMessage(
              order.buyer.athleteProfile.phone,
              `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
            );
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
            throw err;
          }
        }
      }

      if (sentSomething) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
