import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  if (!settings.emailEnabled && !settings.whatsappEnabled) return { checked: 0, notified: 0 };

  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      let sentSomething = false;

      if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, order.id, "EMAIL"))) {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg)) {
          await sendAbandonedCartEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            eventTitle: order.event.title,
            orderId: order.id,
          });
          await markAlertSent(ALERT_TYPE, "Order", order.id, "EMAIL");
          sentSomething = true;
        }
      }

      if (
        settings.whatsappEnabled &&
        order.buyer.athleteProfile?.phone &&
        !(await hasAlertBeenSent(ALERT_TYPE, order.id, "WHATSAPP"))
      ) {
        await sendWhatsAppMessage(
          order.buyer.athleteProfile.phone,
          `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
        );
        await markAlertSent(ALERT_TYPE, "Order", order.id, "WHATSAPP");
        sentSomething = true;
      }

      if (sentSomething) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
