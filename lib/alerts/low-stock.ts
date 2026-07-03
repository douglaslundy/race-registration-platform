import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendLowStockEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getLowStockAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

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

    if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, ticketBatchId, "EMAIL"))) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        await sendLowStockEmail({
          to: organizer.user.email,
          organizerName: organizer.user.name,
          eventTitle: batch.event.title,
          batchName: batch.name,
          soldCount: batch.soldCount,
          capacity: batch.capacity,
        });
        await markAlertSent(ALERT_TYPE, "TicketBatch", ticketBatchId, "EMAIL");
      }
    }

    if (
      settings.whatsappEnabled &&
      organizer.phone &&
      !(await hasAlertBeenSent(ALERT_TYPE, ticketBatchId, "WHATSAPP"))
    ) {
      await sendWhatsAppMessage(
        organizer.phone,
        `Alerta: o lote "${batch.name}" do evento "${batch.event.title}" já vendeu ${batch.soldCount} de ${batch.capacity} vagas.`,
      );
      await markAlertSent(ALERT_TYPE, "TicketBatch", ticketBatchId, "WHATSAPP");
    }
  } catch (err) {
    console.error("[checkLowStockAlert] failed:", err);
  }
}
