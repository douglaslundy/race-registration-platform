import { db } from "../db";

function todayUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function recordImpression(adSlotId: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date: { adSlotId, date } },
      create: { adSlotId, date, impressions: 1, clicks: 0, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { impressions: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar a exibição do anúncio.
  }
}

export async function recordClick(adSlotId: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date: { adSlotId, date } },
      create: { adSlotId, date, impressions: 0, clicks: 1, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { clicks: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar o redirect.
  }
}
