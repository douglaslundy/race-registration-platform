import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserRequestPendingEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAdvertiserRequestAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const ALERT_TYPE = "ADVERTISER_REQUEST_PENDING";

/**
 * Avisa todos os admins que uma nova solicitação de conta de anunciante (já paga) está
 * aguardando aprovação. Seguro para "fire-and-forget": nunca lança e ignora silenciosamente
 * canais desligados ou não configurados. Mesmo padrão de lib/alerts/cancellation-requested.ts.
 */
export async function notifyAdvertiserRequestPending(adPurchaseId: string): Promise<void> {
  try {
    const settings = await getAdvertiserRequestAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const purchase = await db.adPurchase.findUnique({
      where: { id: adPurchaseId },
      select: {
        id: true,
        advertiser: { select: { companyName: true } },
        adPlan: { select: { name: true } },
      },
    });
    if (!purchase) return;

    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, phone: true } });

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const admin of admins) {
          const claimed = await claimAlert(ALERT_TYPE, "AdPurchase", `${adPurchaseId}:${admin.email}`, "EMAIL");
          if (!claimed) continue;
          try {
            await sendAdvertiserRequestPendingEmail({
              to: admin.email,
              companyName: purchase.advertiser.companyName,
              planName: purchase.adPlan.name,
            });
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, `${adPurchaseId}:${admin.email}`, "EMAIL");
            console.error("[notifyAdvertiserRequestPending] email failed for", admin.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const admin of admins) {
        if (!admin.phone) continue;
        const claimed = await claimAlert(ALERT_TYPE, "AdPurchase", `${adPurchaseId}:${admin.phone}`, "WHATSAPP");
        if (!claimed) continue;
        try {
          await sendWhatsAppMessage(
            admin.phone,
            `Nova solicitação de anunciante: ${purchase.advertiser.companyName} (plano ${purchase.adPlan.name}). Acesse o painel pra aprovar ou rejeitar.`,
          );
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, `${adPurchaseId}:${admin.phone}`, "WHATSAPP");
          console.error("[notifyAdvertiserRequestPending] whatsapp failed for", admin.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyAdvertiserRequestPending] failed:", err);
  }
}
