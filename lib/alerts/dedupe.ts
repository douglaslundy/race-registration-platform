import { db } from "@/lib/db";

export type AlertChannel = "EMAIL" | "WHATSAPP";

/**
 * Atomically claims the right to send an alert exactly once, closing the race
 * window between overlapping invocations (e.g. two overlapping cron runs).
 * Returns true when this call wins the claim; false when another call already
 * claimed or sent it. On a claim win, the caller must send the alert and, if
 * the send fails, call unclaimAlert so a later run can retry.
 */
export async function claimAlert(
  alertType: string,
  entityType: string,
  entityId: string,
  channel: AlertChannel,
): Promise<boolean> {
  try {
    await db.alertLog.create({
      data: { alertType, entityType, entityId, channel },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return false;
    throw err;
  }
}

/** Releases a claim after its send actually failed, so a later run can retry. */
export async function unclaimAlert(alertType: string, entityId: string, channel: AlertChannel): Promise<void> {
  await db.alertLog.deleteMany({
    where: { alertType, entityId, channel },
  });
}

/**
 * Unconditionally records that an alert was sent, creating the row if absent or refreshing
 * `sentAt` if one already exists. Used by manual/bypass sends so they still leave a claim behind
 * for later automatic runs to see, even though the manual send itself ignored any prior claim.
 */
export async function recordAlert(
  alertType: string,
  entityType: string,
  entityId: string,
  channel: AlertChannel,
): Promise<void> {
  await db.alertLog.upsert({
    where: { alertType_entityId_channel: { alertType, entityId, channel } },
    create: { alertType, entityType, entityId, channel },
    update: { sentAt: new Date() },
  });
}
