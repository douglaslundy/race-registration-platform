import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendRegistrationCancelledByStaffEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";

/**
 * Avisa o atleta que sua inscrição CONFIRMADA foi cancelada diretamente por um admin/organizador
 * (fora do fluxo em que o próprio atleta pede o cancelamento), com o motivo informado. Diferente
 * de notifyCancellationRequested (que avisa admin/organizador de um pedido do atleta), esta função
 * avisa o próprio atleta do resultado final.
 *
 * Sem dedupe/claim (diferente dos alertas de cron): esta função é chamada uma única vez, de forma
 * síncrona, por uma ação direta e pontual do operador (clique em "Cancelar inscrição") — não há
 * risco de disparo concorrente duplicado pro mesmo cancelamento, então a complexidade de
 * claim/unclaim não se aplica aqui.
 */
export async function notifyRegistrationCancelledByStaff(registrationId: string): Promise<void> {
  try {
    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      select: {
        cancellationReason: true,
        athlete: {
          select: {
            name: true,
            email: true,
            receiveEventMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
        event: { select: { id: true, title: true } },
      },
    });
    if (!registration) return;
    // Cancelamento por admin/organizador é um aviso essencial sobre o evento (não promocional) —
    // mesma convenção de ORDER_CONFIRMED: gateado só por receiveEventMessages.
    if (registration.athlete.receiveEventMessages === false) return;

    const reason = registration.cancellationReason ?? "";

    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      try {
        await sendRegistrationCancelledByStaffEmail({
          to: registration.athlete.email,
          athleteName: registration.athlete.name,
          eventTitle: registration.event.title,
          eventId: registration.event.id,
          reason,
        });
      } catch (err) {
        console.error("[notifyRegistrationCancelledByStaff] email failed:", err);
      }
    }

    const phone = registration.athlete.athleteProfile?.phone;
    if (phone) {
      try {
        const template = await getEffectiveTemplate(
          "REGISTRATION_CANCELLED_BY_STAFF",
          "WHATSAPP",
          "ATHLETE",
          registration.event.id,
        );
        const text = renderTemplate(
          template.body,
          { nome_atleta: registration.athlete.name, nome_evento: registration.event.title, motivo_cancelamento: reason },
          "WHATSAPP",
        );
        await sendWhatsAppMessage(phone, text, "REGISTRATION_CANCELLED_BY_STAFF", { appendPreferencesFooter: true });
      } catch (err) {
        console.error("[notifyRegistrationCancelledByStaff] whatsapp failed:", err);
      }
    }
  } catch (err) {
    console.error("[notifyRegistrationCancelledByStaff] failed:", err);
  }
}
