import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendReconciliationMismatchEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getReconciliationAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import type { PaymentMismatch } from "@/lib/payment/reconciliation";

const ALERT_TYPE = "PAYMENT_RECONCILIATION_MISMATCH";

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
          // Só inclui, no resumo deste admin, as divergências que ainda não foram alertadas a ele
          // — sem isso, uma divergência não corrigida (ex.: gateway ainda PENDING) reapareceria em
          // todo ciclo do cron e o mesmo admin receberia o mesmo resumo pra sempre.
          const newMismatches: PaymentMismatch[] = [];
          for (const mismatch of mismatches) {
            // A chave inclui a divergência específica (localStatus->gatewayStatus), não só o
            // paymentId: sem isso, uma vez que QUALQUER divergência neste pagamento fosse
            // alertada, uma divergência DIFERENTE e futura no mesmo pagamento (ex.: uma correção
            // pending->paid antiga seguida, semanas depois, por um estorno/chargeback) seria
            // silenciosamente engolida pela reivindicação antiga. Mesma lógica de
            // cancellation-requested.ts escopando por cancellationRequestedAt.
            const claimed = await claimAlert(
              ALERT_TYPE,
              "Payment",
              `${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.email}`,
              "EMAIL",
            );
            if (claimed) newMismatches.push(mismatch);
          }
          if (newMismatches.length === 0) continue;
          try {
            await sendReconciliationMismatchEmail({ to: admin.email, mismatches: newMismatches });
          } catch (err) {
            for (const mismatch of newMismatches) {
              await unclaimAlert(
                ALERT_TYPE,
                `${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.email}`,
                "EMAIL",
              );
            }
            console.error("[notifyReconciliationMismatches] email failed for", admin.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const admin of admins) {
        if (!admin.phone) continue;
        const newMismatches: PaymentMismatch[] = [];
        for (const mismatch of mismatches) {
          const claimed = await claimAlert(
            ALERT_TYPE,
            "Payment",
            `${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.phone}`,
            "WHATSAPP",
          );
          if (claimed) newMismatches.push(mismatch);
        }
        if (newMismatches.length === 0) continue;
        const correctedCount = newMismatches.filter((m) => m.corrected).length;
        const manualCount = newMismatches.length - correctedCount;
        try {
          const template = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "WHATSAPP", "ADMIN");
          const text = renderTemplate(
            template.body,
            {
              divergencias_corrigidas: String(correctedCount),
              divergencias_manuais: String(manualCount),
            },
            "WHATSAPP",
          );
          await sendWhatsAppMessage(admin.phone, text);
        } catch (err) {
          for (const mismatch of newMismatches) {
            await unclaimAlert(
              ALERT_TYPE,
              `${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.phone}`,
              "WHATSAPP",
            );
          }
          console.error("[notifyReconciliationMismatches] whatsapp failed for", admin.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyReconciliationMismatches] failed:", err);
  }
}
