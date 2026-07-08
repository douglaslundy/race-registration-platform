import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

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
        athlete: { select: { name: true } },
        event: {
          select: {
            title: true,
            organizer: { select: { user: { select: { email: true, phone: true } } } },
          },
        },
      },
    });
    if (!registration) return;

    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, phone: true } });
    const recipients = [...admins, registration.event.organizer.user];
    const reason = registration.cancellationReason ?? "";

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const recipient of recipients) {
          const claimed = await claimAlert(ALERT_TYPE, "Registration", `${registrationId}:${recipient.email}`, "EMAIL");
          if (!claimed) continue;
          try {
            await sendCancellationRequestedEmail({
              to: recipient.email,
              athleteName: registration.athlete.name,
              eventTitle: registration.event.title,
              reason,
            });
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, `${registrationId}:${recipient.email}`, "EMAIL");
            console.error("[notifyCancellationRequested] email failed for", recipient.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const recipient of recipients) {
        if (!recipient.phone) continue;
        const claimed = await claimAlert(ALERT_TYPE, "Registration", `${registrationId}:${recipient.phone}`, "WHATSAPP");
        if (!claimed) continue;
        try {
          await sendWhatsAppMessage(
            recipient.phone,
            `${registration.athlete.name} solicitou o cancelamento da inscrição em "${registration.event.title}". Motivo: ${reason}. Acesse o painel para aprovar ou rejeitar.`,
          );
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, `${registrationId}:${recipient.phone}`, "WHATSAPP");
          console.error("[notifyCancellationRequested] whatsapp failed for", recipient.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyCancellationRequested] failed:", err);
  }
}
