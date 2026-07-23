import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { recordImpression, recordClick } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

describe("recordImpression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando impressions na linha do dia+source (data zerada, sem hora)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordImpression("slot-1", "PRIVATE");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date_source.source).toBe("PRIVATE");
    expect(call.where.adSlotId_date_source.date.getUTCHours()).toBe(0);
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date_source.date,
      source: "PRIVATE",
      impressions: 1,
      clicks: 0,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ impressions: { increment: 1 } });
  });

  it("usa uma linha separada por source (HOUSE não soma na mesma linha de PRIVATE)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});
    await recordImpression("slot-1", "HOUSE");
    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.source).toBe("HOUSE");
    expect(call.create.source).toBe("HOUSE");
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar a exibição do anúncio)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordImpression("slot-1", "PRIVATE")).resolves.toBeUndefined();
  });
});

describe("recordClick", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando clicks na linha do dia+source", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordClick("slot-1", "PRIVATE");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date_source.source).toBe("PRIVATE");
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date_source.date,
      source: "PRIVATE",
      impressions: 0,
      clicks: 1,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ clicks: { increment: 1 } });
  });

  it("usa uma linha separada por source (HOUSE não soma na mesma linha de PRIVATE)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});
    await recordClick("slot-1", "HOUSE");
    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.source).toBe("HOUSE");
    expect(call.create.source).toBe("HOUSE");
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar o redirect)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordClick("slot-1", "PRIVATE")).resolves.toBeUndefined();
  });
});
