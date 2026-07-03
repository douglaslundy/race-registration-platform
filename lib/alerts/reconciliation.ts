import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendReconciliationMismatchEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getReconciliationAlertSettings } from "./alert-settings";
import type { PaymentMismatch } from "@/lib/payment/reconciliation";

export async function notifyReconciliationMismatches(mismatches: PaymentMismatch[]): Promise<void> {
  if (mismatches.length === 0) return;

  try {
    const settings = await getReconciliationAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const admins = await db.user.findMany({
      where: { role: "ADMIN" },
      select: { email: true, phone: true },
    });

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const admin of admins) {
          try {
            await sendReconciliationMismatchEmail({ to: admin.email, mismatches });
          } catch (err) {
            console.error("[notifyReconciliationMismatches] email failed for", admin.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const admin of admins) {
        if (!admin.phone) continue;
        try {
          await sendWhatsAppMessage(
            admin.phone,
            `Conciliação de pagamentos encontrou ${mismatches.length} divergência(s). Acesse /admin/conciliacao para revisar.`,
          );
        } catch (err) {
          console.error("[notifyReconciliationMismatches] whatsapp failed for", admin.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyReconciliationMismatches] failed:", err);
  }
}
