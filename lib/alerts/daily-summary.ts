import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendDailySummaryEmail, sendEventDailySummaryEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { formatCurrency } from "@/lib/format";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { renderTemplate } from "@/lib/templates/render";
import { claimAlert, unclaimAlert } from "./dedupe";
import {
  getAdminDailySummary,
  getOrganizerDailySummary,
  getEventDailySummary,
  type AdminDailySummary,
  type OrganizerDailySummary,
  type EventDailySummary,
} from "./daily-summary-metrics";

const ALERT_TYPE = "DAILY_SUMMARY";
const ENTITY_TYPE = "DailySummary";
const ALERT_TYPE_EVENT = "DAILY_SUMMARY_EVENT";
const ENTITY_TYPE_EVENT = "DailySummaryEvent";

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

/** Métricas do admin mapeadas pras variáveis do template — reaproveitado pelo WhatsApp e pelo e-mail. */
function buildAdminMetricsValues(m: AdminDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    novos_usuarios: String(m.newUsersCount),
    novos_organizadores: String(m.newOrganizersCount),
    eventos_criados: String(m.eventsCreatedCount),
    taxa_plataforma: formatCurrency(m.platformFeeAmount),
    taxa_servico: formatCurrency(m.serviceFeeAmount),
    repasses_gerados: String(m.payoutsGeneratedCount),
    valor_repasses: formatCurrency(m.payoutsGeneratedAmount),
    cancelamentos_estornos: String(m.cancelledOrRefundedCount),
    link_plataforma: baseUrl,
  };
}

/** Métricas do organizador mapeadas pras variáveis do template — reaproveitado pelo WhatsApp e pelo e-mail. */
function buildOrganizerMetricsValues(m: OrganizerDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    cancelamentos_solicitados: String(m.cancellationsRequestedCount),
    lotes_esgotados: String(m.soldOutBatchesCount),
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
            await sendDailySummaryEmail({ to: admin.email, role: "ADMIN", dateLabel, metrics: emailMetrics });
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
            await sendWhatsAppMessage(admin.phone, await buildAdminWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "WHATSAPP");
          console.error("[sendAdminDailySummaries] failed for", admin.email, err);
        }
      }

      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: admin.id, eventId: null },
        select: { id: true, name: true, type: true, value: true },
      });

      for (const recipient of extraRecipients) {
        const recipientEntityId = `${key}:recipient:${recipient.id}`;

        if (recipient.type === "EMAIL" && smtpReady) {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "EMAIL")) {
              await sendDailySummaryEmail({ to: recipient.value, role: "ADMIN", dateLabel, metrics: emailMetrics });
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
              await sendWhatsAppMessage(recipient.value, await buildAdminWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
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
            await sendWhatsAppMessage(organizer.organizerProfile!.phone, await buildOrganizerWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
            sent++;
          }
        } catch (err) {
          hadFailure = true;
          await unclaimAlert(ALERT_TYPE, entityId, "WHATSAPP");
          console.error("[sendOrganizerDailySummaries] failed for", organizer.email, err);
        }
      }

      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: organizer.id, eventId: null },
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
              await sendWhatsAppMessage(recipient.value, await buildOrganizerWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
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

function buildEventMetricsValues(m: EventDailySummary, eventTitle: string, dateLabel: string): Record<string, string> {
  return {
    data_resumo: dateLabel,
    nome_evento: eventTitle,
    inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_evento: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    cancelamentos_solicitados: String(m.cancellationsRequestedCount),
    vagas_restantes: String(m.vagasRestantes),
  };
}

async function buildEventWhatsAppText(values: Record<string, string>, eventId: string): Promise<string> {
  const template = await getEffectiveTemplate("DAILY_SUMMARY_EVENT", "WHATSAPP", "ADMIN", eventId);
  return renderTemplate(template.body, values, "WHATSAPP");
}

export async function sendEventDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const recipients = await db.dailySummaryRecipient.findMany({
      where: { eventId: { not: null } },
      select: { id: true, name: true, type: true, value: true, eventId: true },
    });
    if (recipients.length === 0) return { sent, failed };

    const eventIds = [...new Set(recipients.map((r) => r.eventId as string))];
    const events = await db.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, title: true, status: true, startAt: true },
    });
    const eventTitleMap = new Map(events.map((e) => [e.id, e.title]));
    // Um evento "encerrado" (a corrida já aconteceu — startAt cai num dia ANTES do dia sendo
    // resumido — ou foi cancelado) não deve mais gerar resumo diário: sem isso, o contato configurado
    // continua recebendo mensagem todo dia pra sempre, mesmo anos depois do evento, até alguém lembrar
    // de remover o contato manualmente na tela de configuração. O dia do próprio evento (startAt cai
    // dentro de [dayStart, dayEnd)) ainda gera o resumo final — só os dias DEPOIS do evento param.
    const activeEventIds = new Set(
      events.filter((e) => e.status !== "CANCELLED" && e.startAt >= dayStart).map((e) => e.id),
    );

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);

    // Calcula a métrica UMA vez por evento (não uma vez por contato) — vários contatos do mesmo
    // evento reaproveitam o mesmo resultado. Eventos encerrados/cancelados nem entram aqui — economiza
    // a consulta de métricas pra um evento que não vai gerar mensagem nenhuma de qualquer forma.
    const metricsCache = new Map<string, EventDailySummary>();
    for (const eventId of eventIds) {
      if (!activeEventIds.has(eventId)) continue;
      try {
        metricsCache.set(eventId, await getEventDailySummary(eventId, dayStart, dayEnd));
      } catch (err) {
        console.error("[sendEventDailySummaries] failed to compute metrics for event", eventId, err);
      }
    }

    for (const recipient of recipients) {
      const eventId = recipient.eventId as string;
      // Evento encerrado/cancelado: pula silenciosamente, sem contar como falha — não é um erro,
      // é o comportamento esperado depois que a corrida acontece.
      if (!activeEventIds.has(eventId)) continue;
      const metrics = metricsCache.get(eventId);
      if (!metrics) {
        failed++;
        continue;
      }
      const eventTitle = eventTitleMap.get(eventId) ?? "Evento removido";
      const values = buildEventMetricsValues(metrics, eventTitle, dateLabel);
      const entityId = `${key}:recipient:${recipient.id}`;

      if (recipient.type === "EMAIL" && smtpReady) {
        try {
          if (await claimAlert(ALERT_TYPE_EVENT, ENTITY_TYPE_EVENT, entityId, "EMAIL")) {
            await sendEventDailySummaryEmail({ to: recipient.value, values, eventId });
            sent++;
          }
        } catch (err) {
          failed++;
          await unclaimAlert(ALERT_TYPE_EVENT, entityId, "EMAIL");
          console.error("[sendEventDailySummaries] failed for", recipient.name, err);
        }
      }

      if (recipient.type === "WHATSAPP") {
        try {
          if (await claimAlert(ALERT_TYPE_EVENT, ENTITY_TYPE_EVENT, entityId, "WHATSAPP")) {
            await sendWhatsAppMessage(recipient.value, await buildEventWhatsAppText(values, eventId), "DAILY_SUMMARY_EVENT");
            sent++;
          }
        } catch (err) {
          failed++;
          await unclaimAlert(ALERT_TYPE_EVENT, entityId, "WHATSAPP");
          console.error("[sendEventDailySummaries] failed for", recipient.name, err);
        }
      }
    }
  } catch (err) {
    console.error("[sendEventDailySummaries] failed:", err);
  }
  return { sent, failed };
}
