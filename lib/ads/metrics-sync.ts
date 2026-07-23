import { db } from "../db";
import { getSetting, upsertSetting } from "../settings";
import { refreshAccessToken } from "./adsense-oauth";
import { fetchDailyAdUnitReport } from "./adsense-reports";

export async function syncAdMetrics(date: Date): Promise<{ synced: number; failed: number }> {
  const refreshToken = await getSetting("google_adsense_refresh_token");
  if (!refreshToken) return { synced: 0, failed: 0 };

  const slots = await db.adSlot.findMany({
    where: { enabled: true, source: "GOOGLE", googleAdUnitId: { not: null } },
  });
  if (slots.length === 0) return { synced: 0, failed: 0 };

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
  } catch {
    await upsertSetting("google_adsense_access_token", "");
    await upsertSetting("google_adsense_refresh_token", "");
    return { synced: 0, failed: 0 };
  }

  const publisherId = await getSetting("google_adsense_publisher_id");
  if (!publisherId) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const slot of slots) {
    try {
      const report = await fetchDailyAdUnitReport({
        accessToken,
        publisherId,
        adUnitId: slot.googleAdUnitId as string,
        date,
      });
      if (!report) continue;

      await db.adMetricsSnapshot.upsert({
        where: { adSlotId_date_source: { adSlotId: slot.id, date, source: "GOOGLE" } },
        create: {
          adSlotId: slot.id,
          date,
          source: "GOOGLE",
          impressions: report.impressions,
          clicks: report.clicks,
          estimatedRevenueMicros: report.estimatedRevenueMicros,
          currency: report.currency,
        },
        update: {
          impressions: report.impressions,
          clicks: report.clicks,
          estimatedRevenueMicros: report.estimatedRevenueMicros,
          currency: report.currency,
        },
      });
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
