import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

describe("recordImpression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando impressions na linha do dia (data zerada, sem hora)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordImpression("slot-1");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date.date.getUTCHours()).toBe(0);
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date.date,
      impressions: 1,
      clicks: 0,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ impressions: { increment: 1 } });
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar a exibição do anúncio)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordImpression("slot-1")).resolves.toBeUndefined();
  });
});
