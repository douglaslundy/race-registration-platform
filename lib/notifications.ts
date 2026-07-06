import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail, sendCancellationRequestedEmail } from "./email";

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
        registrations: { select: { id: true }, take: 1 },
      },
    });

    if (!order?.buyer || order.registrations.length === 0) return;

    await sendRegistrationConfirmationEmail({
      to: order.buyer.email,
      name: order.buyer.name,
      registrationId: order.registrations[0].id,
      eventTitle: order.event?.title,
    });

    await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}

/**
 * Avisa o e-mail de contato do evento que um atleta solicitou o cancelamento da inscrição.
 * Seguro para chamar em "fire-and-forget": não lança e ignora silenciosamente quando o
 * SMTP não está configurado ou o evento não tem e-mail de contato de cancelamento.
 */
export async function notifyCancellationRequested(registrationId: string): Promise<void> {
  try {
    const cfg = await getSmtpConfig();
    if (!isSmtpReady(cfg)) return;

    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      select: {
        cancellationReason: true,
        athlete: { select: { name: true } },
        event: { select: { title: true, cancellationContactEmail: true } },
      },
    });

    if (!registration?.event.cancellationContactEmail) return;

    await sendCancellationRequestedEmail({
      to: registration.event.cancellationContactEmail,
      athleteName: registration.athlete.name,
      eventTitle: registration.event.title,
      reason: registration.cancellationReason ?? "",
    });
  } catch (err) {
    console.error("[notifyCancellationRequested] failed:", err);
  }
}
