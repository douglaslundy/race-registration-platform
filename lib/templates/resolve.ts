import { db } from "@/lib/db";
import { getAlertDefinition, type AlertChannel } from "./registry";

export interface EffectiveTemplate {
  subject?: string;
  body: string;
  source: "event" | "global" | "factory";
}

function factoryFallback(alertKey: string, channel: AlertChannel, recipientRole: string): EffectiveTemplate {
  const def = getAlertDefinition(alertKey);
  if (!def) return { subject: undefined, body: "", source: "factory" };
  const { subject, body } = def.factoryDefault(channel, recipientRole);
  return { subject, body, source: "factory" };
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
        select: { subject: true, body: true },
      });
      if (eventRow) return { subject: eventRow.subject ?? undefined, body: eventRow.body, source: "event" };
    }

    const globalRow = await db.messageTemplate.findFirst({
      where: { alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null, active: true },
      select: { subject: true, body: true },
    });
    if (globalRow) return { subject: globalRow.subject ?? undefined, body: globalRow.body, source: "global" };

    return factoryFallback(alertKey, channel, recipientRole);
  } catch (err) {
    console.error(`[getEffectiveTemplate] falha ao resolver ${alertKey}/${channel}/${recipientRole}, usando fábrica:`, err);
    return factoryFallback(alertKey, channel, recipientRole);
  }
}
