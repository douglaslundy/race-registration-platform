import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";
import { sendWhatsAppMessage } from "./whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { getConnectionState } from "./whatsapp/evolution-client";

async function isWhatsAppConnectionActive(): Promise<boolean> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) return false;
  try {
    return (await getConnectionState(config)) === "open";
  } catch {
    return false;
  }
}

/**
 * Envia a confirmação de inscrição por e-mail e, se houver uma conexão de WhatsApp ativa
 * (instância com status "open"), também por WhatsApp. Seguro para chamar em
 * "fire-and-forget": não lança; cada canal falha de forma independente do outro.
 */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      buyer: { select: { name: true, email: true } },
      event: { select: { title: true } },
      registrations: {
        select: {
          id: true,
          notes: true,
          athlete: { select: { athleteProfile: { select: { phone: true } } } },
        },
        take: 1,
      },
    },
  });

  if (!order?.buyer || order.registrations.length === 0) return;
  const registration = order.registrations[0];

  try {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      await sendRegistrationConfirmationEmail({
        to: order.buyer.email,
        name: order.buyer.name,
        registrationId: registration.id,
        orderId,
        eventTitle: order.event?.title,
        notes: registration.notes ?? undefined,
      });
      await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
    }
  } catch (err) {
    console.error("[notifyOrderConfirmed] email failed:", err);
  }

  const phone = registration.athlete.athleteProfile?.phone;
  if (!phone) return;

  try {
    if (await isWhatsAppConnectionActive()) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
      const eventLabel = order.event?.title ? ` em ${order.event.title}` : "";
      await sendWhatsAppMessage(
        phone,
        `Sua inscrição${eventLabel} foi confirmada! Pedido ${orderId}. Detalhes: ${baseUrl}/dashboard/inscricoes/${registration.id}`,
      );
    }
  } catch (err) {
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}
