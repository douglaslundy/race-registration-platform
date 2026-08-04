import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendDailySummaryEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { formatCurrency } from "@/lib/format";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import { claimAlert, unclaimAlert } from "./dedupe";
import {
  getAdminDailySummary,
  getOrganizerDailySummary,
  type AdminDailySummary,
  type OrganizerDailySummary,
} from "./daily-summary-metrics";

const ALERT_TYPE = "DAILY_SUMMARY";
const ENTITY_TYPE = "DailySummary";

/**
 * "Ontem" no horário de Brasília, expresso como uma janela UTC. O Brasil não observa
 * horário de verão desde 2019, então o deslocamento UTC-3 é fixo e essa aritmética não
 * sofre do bug de DST que já foi encontrado e corrigido nos gráficos do dashboard.
 */
export function getYesterdayBrasiliaWindow(now: Date = new Date()): { dayStart: Date; dayEnd: Date } {
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0, 0));
  const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

function dateKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function formatDateLabel(day: Date): string {
  const dd = String(day.getUTCDate()).padStart(2, "0");
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${day.getUTCFullYear()}`;
}

function buildAdminEmailRows(m: AdminDailySummary): { label: string; value: string }[] {
  return [
    { label: "Novos usuários", value: String(m.newUsersCount) },
    { label: "Novos organizadores", value: String(m.newOrganizersCount) },
    { label: "Eventos criados", value: String(m.eventsCreatedCount) },
    { label: "Inscrições pagas", value: String(m.paidRegistrationsCount) },
    { label: "Receita bruta", value: formatCurrency(m.grossRevenue) },
    { label: "Taxas retidas pela plataforma", value: formatCurrency(m.platformFeesRetained) },
    { label: "Repasses gerados", value: `${m.payoutsGeneratedCount} (${formatCurrency(m.payoutsGeneratedAmount)})` },
    { label: "Cancelamentos/estornos", value: String(m.cancelledOrRefundedCount) },
  ];
}

function buildOrganizerEmailRows(m: OrganizerDailySummary): { label: string; value: string }[] {
  return [
    { label: "Inscrições pagas", value: String(m.paidRegistrationsCount) },
    { label: "Receita", value: formatCurrency(m.grossRevenue) },
    { label: "Cupons usados", value: String(m.couponsUsedCount) },
    { label: "Cancelamentos solicitados", value: String(m.cancellationsRequestedCount) },
    { label: "Lotes esgotados", value: String(m.soldOutBatchesCount) },
  ];
}

/** Métricas do admin mapeadas pras variáveis do template — reaproveitado pelo WhatsApp e pelo e-mail. */
function buildAdminMetricsValues(m: AdminDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    novos_usuarios: String(m.newUsersCount),
    eventos_criados: String(m.eventsCreatedCount),
    link_plataforma: baseUrl,
  };
}

/** Métricas do organizador mapeadas pras variáveis do template — reaproveitado pelo WhatsApp e pelo e-mail. */
function buildOrganizerMetricsValues(m: OrganizerDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    link_plataforma: baseUrl,
  };
}

async function buildAdminWhatsAppText(m: AdminDailySummary, dateLabel: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "WHATSAPP", "ADMIN");
  return renderTemplate(
    template.body,
    {
      data_resumo: dateLabel,
      papel_destinatario: "administrador",
      ...buildAdminMetricsValues(m, baseUrl),
    },
    "WHATSAPP",
  );
}

async function buildOrganizerWhatsAppText(m: OrganizerDailySummary, dateLabel: string): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "WHATSAPP", "ORGANIZER");
  return renderTemplate(
    template.body,
    {
      data_resumo: dateLabel,
      papel_destinatario: "organizador",
      ...buildOrganizerMetricsValues(m, baseUrl),
    },
    "WHATSAPP",
  );
}

export async function sendAdminDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const metrics = await getAdminDailySummary(dayStart, dayEnd);
    const admins = await db.user.findMany({
      where: { role: "ADMIN", active: true },
      select: { id: true, email: true, phone: true, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: true },
    });

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const emailMetrics = buildAdminMetricsValues(metrics, baseUrl);

    for (const admin of admins) {
      const entityId = `${key}:${admin.id}`;
      let hadFailure = false;

      if (admin.dailySummaryEmailEnabled && smtpReady) {
        try {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, entityId, "EMAIL")) {
            await sendDailySummaryEmail({ to: admin.email, role: "ADMIN", dateLabel, rows: buildAdminEmailRows(metrics), metrics: emailMetrics });
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "EMAIL");
          console.error("[sendAdminDailySummaries] failed for", admin.email, err);
        }
      }

      if (admin.dailySummaryWhatsappEnabled && admin.phone) {
        try {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, entityId, "WHATSAPP")) {
            await sendWhatsAppMessage(admin.phone, await buildAdminWhatsAppText(metrics, dateLabel));
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "WHATSAPP");
          console.error("[sendAdminDailySummaries] failed for", admin.email, err);
        }
      }

      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: admin.id },
        select: { id: true, name: true, type: true, value: true },
      });

      for (const recipient of extraRecipients) {
        const recipientEntityId = `${key}:recipient:${recipient.id}`;

        if (recipient.type === "EMAIL" && smtpReady) {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "EMAIL")) {
              await sendDailySummaryEmail({ to: recipient.value, role: "ADMIN", dateLabel, rows: buildAdminEmailRows(metrics), metrics: emailMetrics });
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "EMAIL");
            console.error("[sendAdminDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }

        if (recipient.type === "WHATSAPP") {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "WHATSAPP")) {
              await sendWhatsAppMessage(recipient.value, await buildAdminWhatsAppText(metrics, dateLabel));
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "WHATSAPP");
            console.error("[sendAdminDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }
      }

      if (hadFailure) failed++;
    }
  } catch (err) {
    console.error("[sendAdminDailySummaries] failed:", err);
  }
  return { sent, failed };
}

export async function sendOrganizerDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const organizers = await db.user.findMany({
      where: { role: "ORGANIZER", active: true, organizerProfile: { isNot: null } },
      select: {
        id: true,
        email: true,
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { select: { id: true, phone: true } },
      },
    });

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

    for (const organizer of organizers) {
      const organizerId = organizer.organizerProfile!.id;
      const entityId = `${key}:${organizer.id}`;
      let hadFailure = false;

      let metrics: OrganizerDailySummary;
      try {
        metrics = await getOrganizerDailySummary(organizerId, dayStart, dayEnd);
      } catch (err) {
        failed++;
        console.error("[sendOrganizerDailySummaries] failed for", organizer.email, err);
        continue;
      }
      const emailMetrics = buildOrganizerMetricsValues(metrics, baseUrl);

      if (organizer.dailySummaryEmailEnabled && smtpReady) {
        try {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, entityId, "EMAIL")) {
            await sendDailySummaryEmail({
              to: organizer.email,
              role: "ORGANIZER",
              dateLabel,
              rows: buildOrganizerEmailRows(metrics),
              metrics: emailMetrics,
            });
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "EMAIL");
          console.error("[sendOrganizerDailySummaries] failed for", organizer.email, err);
        }
      }

      if (organizer.dailySummaryWhatsappEnabled && organizer.organizerProfile!.phone) {
        try {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, entityId, "WHATSAPP")) {
            await sendWhatsAppMessage(organizer.organizerProfile!.phone, await buildOrganizerWhatsAppText(metrics, dateLabel));
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "WHATSAPP");
          console.error("[sendOrganizerDailySummaries] failed for", organizer.email, err);
        }
      }

      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: organizer.id },
        select: { id: true, name: true, type: true, value: true },
      });

      for (const recipient of extraRecipients) {
        const recipientEntityId = `${key}:recipient:${recipient.id}`;

        if (recipient.type === "EMAIL" && smtpReady) {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "EMAIL")) {
              await sendDailySummaryEmail({
                to: recipient.value,
                role: "ORGANIZER",
                dateLabel,
                rows: buildOrganizerEmailRows(metrics),
                metrics: emailMetrics,
              });
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "EMAIL");
            console.error("[sendOrganizerDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }

        if (recipient.type === "WHATSAPP") {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "WHATSAPP")) {
              await sendWhatsAppMessage(recipient.value, await buildOrganizerWhatsAppText(metrics, dateLabel));
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "WHATSAPP");
            console.error("[sendOrganizerDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }
      }

      if (hadFailure) failed++;
    }
  } catch (err) {
    console.error("[sendOrganizerDailySummaries] failed:", err);
  }
  return { sent, failed };
}
