import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";

/**
 * Envia a confirmação de inscrição por e-mail quando o pedido é pago.
 * Seguro para chamar em "fire-and-forget": não lança e ignora silenciosamente
 * quando o SMTP não está configurado.
 */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const cfg = await getSmtpConfig();
    if (!isSmtpReady(cfg)) return;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        buyer: { select: { name: true, email: true } },
        event: { select: { title: true } },
        registrations: { select: { id: true, notes: true }, take: 1 },
      },
    });

    if (!order?.buyer || order.registrations.length === 0) return;

    await sendRegistrationConfirmationEmail({
      to: order.buyer.email,
      name: order.buyer.name,
      registrationId: order.registrations[0].id,
      orderId,
      eventTitle: order.event?.title,
      notes: order.registrations[0].notes ?? undefined,
    });

    await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}
