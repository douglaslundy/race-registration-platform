import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

export async function notifyPaymentError(paymentId: string): Promise<void> {
  try {
    const settings = await getPaymentErrorAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            id: true,
            event: { select: { title: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;

    if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, paymentId, "EMAIL"))) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        await sendPaymentErrorEmail({
          to: payment.order.buyer.email,
          name: payment.order.buyer.name,
          eventTitle: payment.order.event.title,
          orderId: payment.order.id,
        });
        await markAlertSent(ALERT_TYPE, "Payment", paymentId, "EMAIL");
      }
    }

    if (
      settings.whatsappEnabled &&
      payment.order.buyer.athleteProfile?.phone &&
      !(await hasAlertBeenSent(ALERT_TYPE, paymentId, "WHATSAPP"))
    ) {
      await sendWhatsAppMessage(
        payment.order.buyer.athleteProfile.phone,
        `Seu pagamento para "${payment.order.event.title}" não foi concluído. Acesse o app para tentar novamente.`,
      );
      await markAlertSent(ALERT_TYPE, "Payment", paymentId, "WHATSAPP");
    }
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}
