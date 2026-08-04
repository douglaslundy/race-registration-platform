import { db } from "@/lib/db";
import { getAlertDefinition, type AlertChannel } from "./registry";

export interface EffectiveTemplate {
  subject?: string;
  body: string;
  rowTemplate?: string;
  source: "event" | "global" | "factory";
}

function factoryFallback(alertKey: string, channel: AlertChannel, recipientRole: string): EffectiveTemplate {
  const def = getAlertDefinition(alertKey);
  if (!def) return { subject: undefined, body: "", source: "factory" };
  const { subject, body } = def.factoryDefault(channel, recipientRole);
  return { subject, body, rowTemplate: def.rowTemplate?.(channel), source: "factory" };
}

export async function getEffectiveTemplate(
  alertKey: string,
  channel: AlertChannel,
  recipientRole: string,
  eventId?: string,
): Promise<EffectiveTemplate> {
  try {
    if (eventId) {
      const eventRow = await db.messageTemplate.findFirst({
        where: { alertKey, channel, recipientRole, scope: "EVENT", eventId, active: true },
        select: { subject: true, body: true, rowTemplate: true },
      });
      if (eventRow) {
        return {
          subject: eventRow.subject ?? undefined,
          body: eventRow.body,
          rowTemplate: eventRow.rowTemplate ?? getAlertDefinition(alertKey)?.rowTemplate?.(channel),
          source: "event",
        };
      }
    }

    const globalRow = await db.messageTemplate.findFirst({
      where: { alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null, active: true },
      select: { subject: true, body: true, rowTemplate: true },
    });
    if (globalRow) {
      return {
        subject: globalRow.subject ?? undefined,
        body: globalRow.body,
        rowTemplate: globalRow.rowTemplate ?? getAlertDefinition(alertKey)?.rowTemplate?.(channel),
        source: "global",
      };
    }

    return factoryFallback(alertKey, channel, recipientRole);
  } catch (err) {
    console.error(`[getEffectiveTemplate] falha ao resolver ${alertKey}/${channel}/${recipientRole}, usando fábrica:`, err);
    try {
      return factoryFallback(alertKey, channel, recipientRole);
    } catch {
      return { subject: undefined, body: "", source: "factory" };
    }
  }
}
