import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { buildAdReportData } from "@/lib/ads/private-ad-report";

const dbMock = db as any;

describe("buildAdReportData", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("soma métricas do período startAt até now (quando endAt ainda não chegou) e monta contato", async () => {
    const startAt = new Date("2026-07-01T00:00:00.000Z");
    const endAt = new Date("2026-07-25T00:00:00.000Z"); // no futuro em relação ao "agora" abaixo
    const now = new Date("2026-07-19T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    dbMock.privateAd.findUnique.mockResolvedValueOnce({
      id: "ad-1",
      imageUrl: "https://example.com/img.png",
      targetUrl: "https://example.com",
      adSlotId: "slot-1",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
      adSlot: { label: "Abaixo do banner", width: 300, height: 250 },
      adPurchase: {
        startAt,
        endAt,
        advertiser: {
          companyName: "Empresa LTDA",
          contactEmail: "contato@empresa.com",
          contactPhone: "+5511999999999",
        },
      },
    });
    dbMock.adMetricsSnapshot.findMany.mockResolvedValueOnce([
      { impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n },
      { impressions: 50, clicks: 2, estimatedRevenueMicros: 500000n },
    ]);

    const result = await buildAdReportData("ad-1");

    expect(dbMock.privateAd.findUnique).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      include: { adSlot: true, adPurchase: { include: { advertiser: true } } },
    });
    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-1", source: "PRIVATE", date: { gte: startAt, lte: now } },
    });
    expect(result).toEqual({
      privateAdId: "ad-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      adLabel: "Abaixo do banner",
      slotWidth: 300,
      slotHeight: 250,
      imageUrl: "https://example.com/img.png",
      targetUrl: "https://example.com",
      periodStart: startAt,
      periodEnd: now,
      impressions: 150,
      clicks: 7,
      estimatedRevenueMicros: 1500000n,
    });
  });

  it("usa endAt como periodEnd quando já passou (min(now, endAt))", async () => {
    const startAt = new Date("2026-06-01T00:00:00.000Z");
    const endAt = new Date("2026-06-30T00:00:00.000Z"); // já passou
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));

    dbMock.privateAd.findUnique.mockResolvedValueOnce({
      id: "ad-2",
      imageUrl: "https://example.com/img2.png",
      targetUrl: "https://example.com/2",
      adSlotId: "slot-2",
      createdAt: startAt,
      adSlot: { label: "Topo", width: 728, height: 90 },
      adPurchase: {
        startAt,
        endAt,
        advertiser: { companyName: "X LTDA", contactEmail: "x@y.com", contactPhone: "+5511888888888" },
      },
    });
    dbMock.adMetricsSnapshot.findMany.mockResolvedValueOnce([]);

    const result = await buildAdReportData("ad-2");

    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-2", source: "PRIVATE", date: { gte: startAt, lte: endAt } },
    });
    expect(result.periodEnd).toEqual(endAt);
    expect(result.impressions).toBe(0);
    expect(result.clicks).toBe(0);
    expect(result.estimatedRevenueMicros).toBe(0n);
  });

  it("lança erro quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    await expect(buildAdReportData("nope")).rejects.toThrow();
  });
});
