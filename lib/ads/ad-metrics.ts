import { db } from "../db";

export interface AdMetricsSummaryRow {
  slotLabel: string;
  impressions: number;
  clicks: number;
  estimatedRevenueMicros: bigint;
}

export async function listAdMetricsSummary(from: Date, to: Date): Promise<AdMetricsSummaryRow[]> {
  const slots = await db.adSlot.findMany({
    include: { metrics: { where: { date: { gte: from, lte: to } } } },
    orderBy: { key: "asc" },
  });

  return slots.map((slot) => ({
    slotLabel: slot.label,
    impressions: slot.metrics.reduce((sum: number, m: { impressions: number }) => sum + m.impressions, 0),
    clicks: slot.metrics.reduce((sum: number, m: { clicks: number }) => sum + m.clicks, 0),
    estimatedRevenueMicros: slot.metrics.reduce(
      (sum: bigint, m: { estimatedRevenueMicros: bigint }) => sum + m.estimatedRevenueMicros,
      0n,
    ),
  }));
}
