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
