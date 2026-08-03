import { db } from "@/lib/db";
import { ALERT_REGISTRY } from "./registry";

export async function seedMessageTemplatesFromRegistry(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const def of Object.values(ALERT_REGISTRY)) {
    for (const channel of def.channels) {
      for (const recipientRole of def.recipientRoles) {
        const existing = await db.messageTemplate.findFirst({
          where: { alertKey: def.alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const { subject, body } = def.factoryDefault(channel, recipientRole);
        await db.messageTemplate.create({
          data: { alertKey: def.alertKey, channel, recipientRole, scope: "GLOBAL", subject, body, active: true },
        });
        created++;
      }
    }
  }

  return { created, skipped };
}
