import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert, recordAlert } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

interface CancellationNotificationTarget {
  entityId: string;
  entityType: "Payment" | "Order";
  alertKey: "PAYMENT_ERROR" | "PAYMENT_ERROR_ORDER_CANCELLED";
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
  event: { id: string; title: string; slug: string };
  bypassDedupe?: boolean;
}

async function sendCancellationInviteNotification(
  settings: { emailEnabled: boolean; whatsappEnabled: boolean },
  params: CancellationNotificationTarget,
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const eventUrl = `${baseUrl}/eventos/${params.event.slug}`;

  if (settings.emailEnabled) {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "EMAIL");
      if (claimed) {
        try {
          await sendPaymentErrorEmail({
            to: params.buyer.email,
            name: params.buyer.name,
            eventTitle: params.event.title,
            eventSlug: params.event.slug,
            eventId: params.event.id,
          });
          if (params.bypassDedupe) await recordAlert(ALERT_TYPE, params.entityType, params.entityId, "EMAIL");
        } catch (err) {
          if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "EMAIL");
          throw err;
        }
      }
    }
  }

  if (settings.whatsappEnabled && params.buyer.athleteProfile?.phone) {
    const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "WHATSAPP");
    if (claimed) {
      try {
        const template = await getEffectiveTemplate(params.alertKey, "WHATSAPP", "BUYER", params.event.id);
        const text = renderTemplate(template.body, {
          nome_atleta: params.buyer.name,
          nome_evento: params.event.title,
          link_evento: eventUrl,
        }, "WHATSAPP");
        await sendWhatsAppMessage(params.buyer.athleteProfile.phone, text);
        if (params.bypassDedupe) await recordAlert(ALERT_TYPE, params.entityType, params.entityId, "WHATSAPP");
      } catch (err) {
        if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "WHATSAPP");
        throw err;
      }
    }
  }
}

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
            event: { select: { id: true, title: true, slug: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;
    if (!payment.order) {
      // Este alerta só cobre pagamentos de Order (checkout). Cai no catch abaixo e loga alto em vez
      // de silenciosamente deixar de notificar.
      throw new Error(`Payment ${paymentId} sem order associado (notifyPaymentError)`);
    }

    await sendCancellationInviteNotification(settings, {
      entityId: paymentId,
      entityType: "Payment",
      alertKey: "PAYMENT_ERROR",
      buyer: payment.order.buyer,
      event: payment.order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}

export async function notifyOrderCancelledWithoutPayment(
  orderId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const settings = await getPaymentErrorAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        event: { select: { id: true, title: true, slug: true } },
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      },
    });

    if (!order) return;

    await sendCancellationInviteNotification(settings, {
      entityId: orderId,
      entityType: "Order",
      alertKey: "PAYMENT_ERROR_ORDER_CANCELLED",
      buyer: order.buyer,
      event: order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyOrderCancelledWithoutPayment] failed:", err);
  }
}
