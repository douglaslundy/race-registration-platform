import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, recordAlert, unclaimAlert } from "./dedupe";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import { getSocialPromoText } from "@/lib/event-social-links";

const ALERT_TYPE = "ABANDONED_CART";

export interface AbandonedOrder {
  id: string;
  buyerUserId: string;
  event: { id: string; title: string };
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
}

export async function sendAbandonedCartAlert(
  order: AbandonedOrder,
  settings: { emailEnabled: boolean; whatsappEnabled: boolean },
  options?: { bypassDedupe?: boolean },
): Promise<{ sent: boolean }> {
  const bypassDedupe = options?.bypassDedupe ?? false;

  let sentSomething = false;

  // Resolvida sob demanda e memoizada — reaproveitada tanto no e-mail quanto no WhatsApp deste
  // mesmo pedido/comprador. getSocialPromoText tem efeito colateral (incrementa a contagem de
  // envio de cada link), então NÃO pode ser chamada antes das guardas de cada canal (SMTP pronto,
  // claim de dedupe, telefone cadastrado): checkAbandonedCarts() reprocessa o mesmo pedido PENDING
  // a cada ciclo de cron (ver comentário no finally abaixo), então chamar isso cedo demais
  // "gastaria" a cota do usuário em execuções que não enviam nada por já estarem bloqueadas pelo
  // dedupe. A memoização garante no máximo 1 chamada real por execução mesmo com os 2 canais.
  let socialPromoCache: string | undefined;
  const resolveSocialPromo = async () =>
    (socialPromoCache ??= await getSocialPromoText(order.event.id, order.buyerUserId));

  try {
    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg) && (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL")))) {
        try {
          await sendAbandonedCartEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            eventTitle: order.event.title,
            orderId: order.id,
            eventId: order.event.id,
            socialPromo: await resolveSocialPromo(),
          });
          if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", order.id, "EMAIL");
          sentSomething = true;
        } catch (err) {
          if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
          throw err;
        }
      }
    }

    if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
      if (bypassDedupe || (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP"))) {
        try {
          const template = await getEffectiveTemplate("ABANDONED_CART", "WHATSAPP", "BUYER", order.event.id);
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
          const text = renderTemplate(
            template.body,
            {
              nome_atleta: order.buyer.name,
              nome_evento: order.event.title,
              link_finalizar_pagamento: `${baseUrl}/dashboard/inscricoes`,
              redes_sociais: await resolveSocialPromo(),
            },
            "WHATSAPP",
          );
          await sendWhatsAppMessage(order.buyer.athleteProfile.phone, text, "ABANDONED_CART");
          if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP");
          sentSomething = true;
        } catch (err) {
          if (!bypassDedupe) await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
          throw err;
        }
      }
    }
  } finally {
    // Só grava auditoria quando um aviso real foi enviado — sem isso, checkAbandonedCarts()
    // reprocessando o mesmo pedido PENDING a cada ciclo de cron gerava uma linha nova por execução,
    // pra sempre, mesmo quando o dedupe já tinha bloqueado ambos os canais (nada de novo aconteceu).
    // Fica num finally (em vez de só depois dos dois blocos) porque cada canal lança na própria
    // falha: se o e-mail for enviado com sucesso (sentSomething = true) e o WhatsApp em seguida
    // lançar, a função sai por esse throw — sem o finally, a auditoria do envio real do e-mail
    // nunca seria gravada, mesmo tendo genuinamente acontecido.
    if (sentSomething) {
      await db.auditLog.create({
        data: {
          userId: order.buyerUserId,
          action: "CART_ABANDONED",
          entityType: "Order",
          entityId: order.id,
          metadata: { eventTitle: order.event.title },
        },
      });
    }
  }

  return { sent: sentSomething };
}

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      buyerUserId: true,
      event: { select: { id: true, title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      const { sent } = await sendAbandonedCartAlert(order, settings);
      if (sent) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
