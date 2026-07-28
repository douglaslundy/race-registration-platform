import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";
import { sendWhatsAppMessage } from "./whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { getConnectionState } from "./whatsapp/evolution-client";
import { isPlaceholderEmail } from "./proxy-athlete";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const ALERT_TYPE = "ORDER_CONFIRMED";

async function isWhatsAppConnectionActive(): Promise<boolean> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) return false;
  try {
    return (await getConnectionState(config)) === "open";
  } catch {
    return false;
  }
}

async function sendWhatsAppIfActive(
  phone: string | null | undefined,
  text: string,
  eventId: string | undefined,
  claimEntityId: string,
  bypassDedupe: boolean,
): Promise<void> {
  if (!phone) return;
  try {
    if (!(await isWhatsAppConnectionActive())) return;
    const claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
    if (!claimed) return;
    await sendWhatsAppMessage(
      phone,
      text,
      eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
    );
  } catch (err) {
    if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, claimEntityId, "WHATSAPP");
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}

/**
 * Envia a confirmação de inscrição por e-mail e, se houver uma conexão de WhatsApp ativa
 * (instância com status "open"), também por WhatsApp. Seguro para chamar em
 * "fire-and-forget": não lança; cada canal falha de forma independente do outro.
 *
 * Quando a inscrição é por procuração (order.buyerUserId !== registration.athleteUserId), o
 * comprador recebe uma mensagem avisando quem ele inscreveu, e o atleta recebe uma mensagem
 * separada avisando quem criou a inscrição pra ele (e-mail só se não for sintético).
 */
export async function notifyOrderConfirmed(
  orderId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const bypassDedupe = options?.bypassDedupe ?? false;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        buyerUserId: true,
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
        event: { select: { id: true, title: true } },
        registrations: {
          select: {
            id: true,
            notes: true,
            athleteUserId: true,
            proxyAthleteDisplayName: true,
            athlete: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
          take: 1,
        },
      },
    });

    if (!order?.buyer || order.registrations.length === 0) return;
    const registration = order.registrations[0];

    const eventLabel = order.event?.title ? ` em ${order.event.title}` : "";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const detailsUrl = `${baseUrl}/dashboard/inscricoes/${registration.id}`;
    const isProxyRegistration = order.buyerUserId !== registration.athleteUserId;

    // Comprador — sempre recebe. Quando não é procuração, é a única mensagem (idêntico ao
    // comportamento de sempre); quando é, o texto deixa claro que ele inscreveu outra pessoa.
    // Cada canal/destinatário reivindica sua própria chave de dedupe (em vez de uma única
    // reivindicação pra função inteira): isso evita que o reenvio manual de confirmação
    // (admin/organizador) vire permanentemente um no-op depois do primeiro envio automático bem
    // sucedido — options.bypassDedupe (usado pelas rotas de reenvio/confirmação manual) ignora a
    // reivindicação sem apagar o registro de quem já reivindicou de forma automática.
    try {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        const claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", orderId, "EMAIL");
        if (claimed) {
          await sendRegistrationConfirmationEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            registrationId: registration.id,
            orderId,
            eventTitle: order.event?.title,
            eventId: order.event?.id,
            notes: registration.notes ?? undefined,
          });
          await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
        }
      }
    } catch (err) {
      if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, orderId, "EMAIL");
      console.error("[notifyOrderConfirmed] email failed:", err);
    }

    const buyerWhatsappPhone = isProxyRegistration
      ? order.buyer.athleteProfile?.phone
      : registration.athlete.athleteProfile?.phone;
    const buyerWhatsappText = isProxyRegistration
      ? `Você inscreveu ${registration.proxyAthleteDisplayName ?? registration.athlete.name}${eventLabel}! Pedido ${orderId}. Detalhes: ${detailsUrl}`
      : `Sua inscrição${eventLabel} foi confirmada! Pedido ${orderId}. Detalhes: ${detailsUrl}`;
    await sendWhatsAppIfActive(buyerWhatsappPhone, buyerWhatsappText, order.event?.id, `${orderId}:buyer`, bypassDedupe);

    if (!isProxyRegistration) return;

    // Atleta — só quando é procuração (o comprador já foi tratado acima).
    if (!isPlaceholderEmail(registration.athlete.email)) {
      try {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg)) {
          const claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", `${orderId}:athlete`, "EMAIL");
          if (claimed) {
            await sendRegistrationConfirmationEmail({
              to: registration.athlete.email,
              name: registration.athlete.name,
              registrationId: registration.id,
              orderId,
              eventTitle: order.event?.title,
              eventId: order.event?.id,
              notes: registration.notes ?? undefined,
            });
          }
        }
      } catch (err) {
        if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, `${orderId}:athlete`, "EMAIL");
        console.error("[notifyOrderConfirmed] athlete email failed:", err);
      }
    }

    await sendWhatsAppIfActive(
      registration.athlete.athleteProfile?.phone,
      `${order.buyer.name} criou uma inscrição pra você${eventLabel}! Pedido ${orderId}. Detalhes: ${detailsUrl}`,
      order.event?.id,
      `${orderId}:athlete`,
      bypassDedupe,
    );
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}
