import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

export async function notifyPaymentError(
  paymentId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const settings = await getPaymentErrorAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            event: { select: { title: true, slug: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const eventUrl = `${baseUrl}/eventos/${payment.order.event.slug}`;

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        const claimed = options?.bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Payment", paymentId, "EMAIL");
        if (claimed) {
          try {
            await sendPaymentErrorEmail({
              to: payment.order.buyer.email,
              name: payment.order.buyer.name,
              eventTitle: payment.order.event.title,
              eventSlug: payment.order.event.slug,
            });
          } catch (err) {
            if (!options?.bypassDedupe) await unclaimAlert(ALERT_TYPE, paymentId, "EMAIL");
            throw err;
          }
        }
      }
    }

    if (settings.whatsappEnabled && payment.order.buyer.athleteProfile?.phone) {
      const claimed = options?.bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Payment", paymentId, "WHATSAPP");
      if (claimed) {
        try {
          await sendWhatsAppMessage(
            payment.order.buyer.athleteProfile.phone,
            `Sua inscrição em "${payment.order.event.title}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${eventUrl}`,
          );
        } catch (err) {
          if (!options?.bypassDedupe) await unclaimAlert(ALERT_TYPE, paymentId, "WHATSAPP");
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}
