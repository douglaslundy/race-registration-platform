import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";
import { sendWhatsAppMessage, sendWhatsAppDocument } from "./whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { getConnectionState } from "./whatsapp/evolution-client";
import { isPlaceholderEmail } from "./proxy-athlete";
import { claimAlert, unclaimAlert, recordAlert } from "@/lib/alerts/dedupe";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import { getSocialPromoText } from "@/lib/event-social-links";
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";

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
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_BUYER" | "ORDER_CONFIRMED_PROXY_ATHLETE",
  recipientRole: "BUYER" | "ATHLETE",
  recipientReceivesEventMessages: boolean,
  values: Record<string, string | undefined>,
  eventId: string | undefined,
  claimEntityId: string,
  bypassDedupe: boolean,
  resolveSocialPromo: () => Promise<string>,
  kitQrCodeBase64: string,
  kitQrCaption: string,
): Promise<void> {
  if (!phone) return;
  // Revalidado a cada chamada (não é um valor cacheado do momento em que o pedido foi criado): o
  // destinatário pode ter desativado "mensagens de eventos" entre a criação do pedido e este envio.
  if (recipientReceivesEventMessages === false) return;
  let claimed = false;
  try {
    if (!(await isWhatsAppConnectionActive())) return;
    claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
    if (!claimed) return;
    const template = await getEffectiveTemplate(alertKey, "WHATSAPP", recipientRole, eventId);
    // resolveSocialPromo só é chamada aqui, depois de todas as guardas acima (telefone presente,
    // conexão de WhatsApp ativa, claim de dedupe bem sucedido) — é o ponto em que o envio de fato
    // vai acontecer, então é seguro "gastar" a cota do link social agora.
    const text = renderTemplate(template.body, { ...values, redes_sociais: await resolveSocialPromo() }, "WHATSAPP");
    await sendWhatsAppMessage(phone, text, alertKey, {
      appendPreferencesFooter: true,
      ...(eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : {}),
    });
    if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");

    try {
      await sendWhatsAppDocument(
        phone,
        kitQrCodeBase64,
        "qrcode-retirada-kit.png",
        kitQrCaption,
        eventId
          ? { messageType: alertKey, relatedEntityType: "Event", relatedEntityId: eventId, mediatype: "image" }
          : { messageType: alertKey, mediatype: "image" },
      );
    } catch (err) {
      console.error("[notifyOrderConfirmed] whatsapp kit QR attachment failed:", err);
    }
  } catch (err) {
    // Só desfaz a reivindicação se ESTA chamada realmente a tomou — caso contrário, uma falha
    // antes do claim (ex.: getWhatsAppConfig lançando) apagaria a reivindicação de um envio
    // anterior bem-sucedido, reabrindo a janela de duplicidade que esta trava existe pra fechar.
    if (claimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, claimEntityId, "WHATSAPP");
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
        buyer: {
          select: {
            name: true,
            email: true,
            receiveEventMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
        event: { select: { id: true, title: true } },
        registrations: {
          select: {
            id: true,
            notes: true,
            athleteUserId: true,
            proxyAthleteDisplayName: true,
            athlete: {
              select: {
                name: true,
                email: true,
                receiveEventMessages: true,
                athleteProfile: { select: { phone: true, cpf: true } },
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!order?.buyer || order.registrations.length === 0) return;
    const registration = order.registrations[0];

    const kitQrCodePng = await generateKitQrCodePng(registration.id);
    const kitQrCodeBase64 = kitQrCodePng.toString("base64");
    // Nome + CPF do atleta abaixo da legenda: permite localizar a inscrição no balcão de retirada
    // (busca por nome/CPF em lib/kit-delivery.ts) quando não há leitor de QR code disponível.
    const kitQrCaption = `Apresente este QR code na retirada do kit\nNome: ${registration.proxyAthleteDisplayName ?? registration.athlete.name}\nCPF: ${registration.athlete.athleteProfile?.cpf ?? "não informado"}`;

    const sponsorPromo = await getSponsorPromoText(order.event?.id ?? "");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const detailsUrl = `${baseUrl}/dashboard/inscricoes/${registration.id}`;
    const isProxyRegistration = order.buyerUserId !== registration.athleteUserId;

    // Promoção de redes sociais do evento pro usuário-alvo desta notificação (o atleta sendo
    // inscrito), resolvida sob demanda e memoizada — reaproveitada em todos os envios desta
    // execução (e-mail/WhatsApp do comprador e, se por procuração, e-mail/WhatsApp do atleta).
    // getSocialPromoText tem efeito colateral (incrementa a contagem de envio de cada link), então
    // NÃO pode ser chamada antes das guardas de cada canal (SMTP pronto, claim de dedupe,
    // telefone cadastrado) — do contrário uma execução que não envia nada (ex.: dedupe já
    // reivindicado por uma execução anterior) ainda assim "gastaria" uma cota do usuário à toa.
    // A memoização garante no máximo 1 chamada real por execução mesmo com os 4 pontos de envio.
    let socialPromoCache: string | undefined;
    const resolveSocialPromo = async () =>
      (socialPromoCache ??= await getSocialPromoText(order.event?.id ?? "", registration.athleteUserId));

    // Comprador — sempre recebe. Quando não é procuração, é a única mensagem (idêntico ao
    // comportamento de sempre); quando é, o texto deixa claro que ele inscreveu outra pessoa.
    // Cada canal/destinatário reivindica sua própria chave de dedupe (em vez de uma única
    // reivindicação pra função inteira): isso evita que o reenvio manual de confirmação
    // (admin/organizador) vire permanentemente um no-op depois do primeiro envio automático bem
    // sucedido — options.bypassDedupe (usado pelas rotas de reenvio/confirmação manual) ignora a
    // reivindicação sem apagar o registro de quem já reivindicou de forma automática.
    let buyerEmailClaimed = false;
    try {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg) && order.buyer.receiveEventMessages !== false) {
        buyerEmailClaimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", orderId, "EMAIL");
        if (buyerEmailClaimed) {
          await sendRegistrationConfirmationEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            registrationId: registration.id,
            orderId,
            eventTitle: order.event?.title,
            eventId: order.event?.id,
            sponsorPromo,
            socialPromo: await resolveSocialPromo(),
            notes: registration.notes ?? undefined,
            alertKey: "ORDER_CONFIRMED",
            recipientRole: "BUYER",
            kitQrCodePng,
          });
          await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
          if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", orderId, "EMAIL");
        }
      }
    } catch (err) {
      // Só desfaz a reivindicação se ESTA chamada realmente a tomou — ver comentário equivalente
      // em sendWhatsAppIfActive.
      if (buyerEmailClaimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, orderId, "EMAIL");
      console.error("[notifyOrderConfirmed] email failed:", err);
    }

    const buyerWhatsappPhone = isProxyRegistration
      ? order.buyer.athleteProfile?.phone
      : registration.athlete.athleteProfile?.phone;
    const buyerWhatsappAlertKey = isProxyRegistration ? "ORDER_CONFIRMED_PROXY_BUYER" : "ORDER_CONFIRMED";
    await sendWhatsAppIfActive(
      buyerWhatsappPhone,
      buyerWhatsappAlertKey,
      "BUYER",
      order.buyer.receiveEventMessages,
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        patrocinio: sponsorPromo,
      },
      order.event?.id,
      `${orderId}:buyer`,
      bypassDedupe,
      resolveSocialPromo,
      kitQrCodeBase64,
      kitQrCaption,
    );

    if (!isProxyRegistration) return;

    // Atleta — só quando é procuração (o comprador já foi tratado acima).
    if (!isPlaceholderEmail(registration.athlete.email)) {
      let athleteEmailClaimed = false;
      try {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg) && registration.athlete.receiveEventMessages !== false) {
          athleteEmailClaimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", `${orderId}:athlete`, "EMAIL");
          if (athleteEmailClaimed) {
            await sendRegistrationConfirmationEmail({
              to: registration.athlete.email,
              name: registration.athlete.name,
              registrationId: registration.id,
              orderId,
              eventTitle: order.event?.title,
              eventId: order.event?.id,
              sponsorPromo,
              socialPromo: await resolveSocialPromo(),
              notes: registration.notes ?? undefined,
              alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
              recipientRole: "ATHLETE",
              buyerName: order.buyer.name,
              kitQrCodePng,
            });
            if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", `${orderId}:athlete`, "EMAIL");
          }
        }
      } catch (err) {
        if (athleteEmailClaimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, `${orderId}:athlete`, "EMAIL");
        console.error("[notifyOrderConfirmed] athlete email failed:", err);
      }
    }

    await sendWhatsAppIfActive(
      registration.athlete.athleteProfile?.phone,
      "ORDER_CONFIRMED_PROXY_ATHLETE",
      "ATHLETE",
      registration.athlete.receiveEventMessages,
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_comprador: order.buyer.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        patrocinio: sponsorPromo,
      },
      order.event?.id,
      `${orderId}:athlete`,
      bypassDedupe,
      resolveSocialPromo,
      kitQrCodeBase64,
      kitQrCaption,
    );
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}
