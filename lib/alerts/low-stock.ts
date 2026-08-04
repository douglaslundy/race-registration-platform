import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendLowStockEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getLowStockAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";

const ALERT_TYPE = "LOW_STOCK";

export async function checkLowStockAlert(ticketBatchId: string): Promise<void> {
  try {
    const settings = await getLowStockAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const batch = await db.ticketBatch.findUnique({
      where: { id: ticketBatchId },
      select: {
        id: true,
        name: true,
        capacity: true,
        soldCount: true,
        event: {
          select: {
            id: true,
            title: true,
            organizer: {
              select: { phone: true, user: { select: { name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!batch || batch.capacity <= 0) return;

    const percent = (batch.soldCount / batch.capacity) * 100;
    if (percent < settings.thresholdPercent) return;

    const organizer = batch.event.organizer;

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg) && (await claimAlert(ALERT_TYPE, "TicketBatch", ticketBatchId, "EMAIL"))) {
        try {
          await sendLowStockEmail({
            to: organizer.user.email,
            organizerName: organizer.user.name,
            eventTitle: batch.event.title,
            batchName: batch.name,
            soldCount: batch.soldCount,
            capacity: batch.capacity,
            eventId: batch.event.id,
          });
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, ticketBatchId, "EMAIL");
          throw err;
        }
      }
    }

    if (settings.whatsappEnabled && organizer.phone) {
      if (await claimAlert(ALERT_TYPE, "TicketBatch", ticketBatchId, "WHATSAPP")) {
        try {
          const template = await getEffectiveTemplate("LOW_STOCK", "WHATSAPP", "ORGANIZER", batch.event.id);
          const percent = Math.round((batch.soldCount / batch.capacity) * 100);
          const text = renderTemplate(template.body, {
            nome_organizador: organizer.user.name,
            nome_evento: batch.event.title,
            nome_lote: batch.name,
            vagas_vendidas: String(batch.soldCount),
            capacidade_lote: String(batch.capacity),
            percentual_vendido: String(percent),
          }, "WHATSAPP");
          await sendWhatsAppMessage(organizer.phone, text);
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, ticketBatchId, "WHATSAPP");
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("[checkLowStockAlert] failed:", err);
  }
}
