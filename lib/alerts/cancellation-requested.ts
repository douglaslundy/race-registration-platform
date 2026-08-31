import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";

const ALERT_TYPE = "CANCELLATION_REQUESTED";

/**
 * Avisa todos os admins e o organizador do evento que um atleta solicitou o
 * cancelamento da inscrição e precisa de aprovação. Seguro para "fire-and-forget":
 * nunca lança e ignora silenciosamente canais desligados ou não configurados.
 */
export async function notifyCancellationRequested(registrationId: string): Promise<void> {
  try {
    const settings = await getCancellationAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      select: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        participantName: true,
        event: {
          select: {
            id: true,
            title: true,
            organizer: { select: { user: { select: { email: true, phone: true } } } },
          },
        },
      },
    });
    if (!registration) return;

    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, phone: true } });
    const recipients = [...admins, registration.event.organizer.user];
    const organizerUser = registration.event.organizer.user;
    // Mesmo texto de fábrica hoje pros dois papéis, mas resolver por destinatário real (em vez de
    // fixar "ADMIN" pra todos) permite customização futura de ADMIN vs ORGANIZER sem tocar aqui de novo.
    const recipientRoleFor = (recipient: (typeof recipients)[number]): "ADMIN" | "ORGANIZER" =>
      recipient === organizerUser ? "ORGANIZER" : "ADMIN";
    const reason = registration.cancellationReason ?? "";
    // Escopa a chave de dedupe por solicitação (não só por inscrição): sem o timestamp, uma
    // segunda solicitação de cancelamento na MESMA inscrição (ex.: admin rejeita a primeira, o
    // atleta pede de novo) reencontraria o claim antigo, nunca expirado, e ninguém seria avisado
    // da nova solicitação. cancellationRequestedAt é regravado a cada nova solicitação
    // (app/api/registrations/[id]/cancel/route.ts), então serve de escopo natural por tentativa.
    const requestKey = registration.cancellationRequestedAt
      ? `${registrationId}:${registration.cancellationRequestedAt.toISOString()}`
      : registrationId;

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const recipient of recipients) {
          const claimed = await claimAlert(ALERT_TYPE, "Registration", `${requestKey}:${recipient.email}`, "EMAIL");
          if (!claimed) continue;
          try {
            await sendCancellationRequestedEmail({
              to: recipient.email,
              athleteName: registration.participantName,
              eventTitle: registration.event.title,
              eventId: registration.event.id,
              reason,
              recipientRole: recipientRoleFor(recipient),
            });
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, `${requestKey}:${recipient.email}`, "EMAIL");
            console.error("[notifyCancellationRequested] email failed for", recipient.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const recipient of recipients) {
        if (!recipient.phone) continue;
        const claimed = await claimAlert(ALERT_TYPE, "Registration", `${requestKey}:${recipient.phone}`, "WHATSAPP");
        if (!claimed) continue;
        try {
          const template = await getEffectiveTemplate(
            "CANCELLATION_REQUESTED",
            "WHATSAPP",
            recipientRoleFor(recipient),
            registration.event.id,
          );
          const text = renderTemplate(
            template.body,
            {
              nome_atleta: registration.participantName,
              nome_evento: registration.event.title,
              motivo_cancelamento: reason,
            },
            "WHATSAPP",
          );
          await sendWhatsAppMessage(recipient.phone, text, "CANCELLATION_REQUESTED");
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, `${requestKey}:${recipient.phone}`, "WHATSAPP");
          console.error("[notifyCancellationRequested] whatsapp failed for", recipient.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyCancellationRequested] failed:", err);
  }
}
