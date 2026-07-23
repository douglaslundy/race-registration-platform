import { db } from "../db";

export interface AdReportData {
  privateAdId: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  adLabel: string;
  slotWidth: number;
  slotHeight: number;
  imageUrl: string;
  targetUrl: string;
  periodStart: Date;
  periodEnd: Date;
  impressions: number;
  clicks: number;
  estimatedRevenueMicros: bigint;
}

/**
 * Monta os dados do relatório de um anúncio privado: dados de contato do anunciante, label/
 * dimensões da posição e a soma dos AdMetricsSnapshot da posição no período em que o anúncio
 * ficou no ar (adPurchase.startAt até min(now, adPurchase.endAt)).
 */
export async function buildAdReportData(privateAdId: string): Promise<AdReportData> {
  const ad = await db.privateAd.findUnique({
    where: { id: privateAdId },
    include: { adSlot: true, adPurchase: { include: { advertiser: true } } },
  });

  if (!ad) {
    throw new Error("Anúncio não encontrado");
  }

  const now = new Date();
  const periodStart = ad.adPurchase.startAt ?? ad.createdAt;
  const periodEnd = ad.adPurchase.endAt && ad.adPurchase.endAt < now ? ad.adPurchase.endAt : now;

  // Só soma métricas do marketplace (source "PRIVATE") — uma posição pode ter sido usada como
  // anúncio da casa (source "HOUSE") em parte do período, e essas métricas nunca devem entrar na
  // conta do anunciante pagante.
  const snapshots = await db.adMetricsSnapshot.findMany({
    where: { adSlotId: ad.adSlotId, source: "PRIVATE", date: { gte: periodStart, lte: periodEnd } },
  });

  const impressions = snapshots.reduce((sum: number, s: { impressions: number }) => sum + s.impressions, 0);
  const clicks = snapshots.reduce((sum: number, s: { clicks: number }) => sum + s.clicks, 0);
  const estimatedRevenueMicros = snapshots.reduce(
    (sum: bigint, s: { estimatedRevenueMicros: bigint }) => sum + s.estimatedRevenueMicros,
    0n,
  );

  return {
    privateAdId: ad.id,
    companyName: ad.adPurchase.advertiser.companyName,
    contactEmail: ad.adPurchase.advertiser.contactEmail,
    contactPhone: ad.adPurchase.advertiser.contactPhone,
    adLabel: ad.adSlot.label,
    slotWidth: ad.adSlot.width,
    slotHeight: ad.adSlot.height,
    imageUrl: ad.imageUrl,
    targetUrl: ad.targetUrl,
    periodStart,
    periodEnd,
    impressions,
    clicks,
    estimatedRevenueMicros,
  };
}
