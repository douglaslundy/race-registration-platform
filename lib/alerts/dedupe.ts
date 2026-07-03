import { db } from "@/lib/db";

export type AlertChannel = "EMAIL" | "WHATSAPP";

export async function hasAlertBeenSent(alertType: string, entityId: string, channel: AlertChannel): Promise<boolean> {
  const existing = await db.alertLog.findUnique({
    where: { alertType_entityId_channel: { alertType, entityId, channel } },
  });
  return existing !== null;
}

export async function markAlertSent(
  alertType: string,
  entityType: string,
  entityId: string,
  channel: AlertChannel,
): Promise<void> {
  await db.alertLog.create({
    data: { alertType, entityType, entityId, channel },
  });
}
