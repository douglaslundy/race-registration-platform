export interface DailyAdUnitReport {
  impressions: number;
  clicks: number;
  estimatedRevenueMicros: bigint;
  currency: string;
}

export async function fetchDailyAdUnitReport(params: {
  accessToken: string;
  publisherId: string;
  adUnitId: string;
  date: Date;
}): Promise<DailyAdUnitReport | null> {
  const { accessToken, publisherId, adUnitId, date } = params;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const query = new URLSearchParams({
    dateRange: "CUSTOM",
    "startDate.year": String(year),
    "startDate.month": String(month),
    "startDate.day": String(day),
    "endDate.year": String(year),
    "endDate.month": String(month),
    "endDate.day": String(day),
    filters: `AD_UNIT_ID==${adUnitId}`,
  });
  query.append("metrics", "IMPRESSIONS");
  query.append("metrics", "CLICKS");
  query.append("metrics", "ESTIMATED_EARNINGS");

  const url = `https://adsense.googleapis.com/v2/accounts/${publisherId}/reports:generate?${query.toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`AdSense API ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }

  const data = await res.json();
  const row = data.rows?.[0];
  if (!row) return null;

  const [impressionsCell, clicksCell, earningsCell] = row.cells;
  return {
    impressions: parseInt(impressionsCell.value, 10),
    clicks: parseInt(clicksCell.value, 10),
    estimatedRevenueMicros: BigInt(earningsCell.value),
    currency: "BRL",
  };
}
