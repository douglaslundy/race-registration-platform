import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAvailableSlotsForAdvertiser, hasAvailableSlotInPurchase } from "@/lib/ads/private-ads";

const dbMock = db as any;

describe("listAvailableSlotsForAdvertiser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna só posições sem PrivateAd APPROVED ativo", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "slot-1", key: "A" }]);

    const result = await listAvailableSlotsForAdvertiser();

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { privateAds: { none: { status: "APPROVED" } } },
      orderBy: { key: "asc" },
    });
    expect(result).toEqual([{ id: "slot-1", key: "A" }]);
  });
});

describe("hasAvailableSlotInPurchase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna true quando o número de anúncios ativos é menor que o limite do plano", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 3 },
      ads: [{ status: "APPROVED" }, { status: "PENDING_APPROVAL" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(true);
  });

  it("retorna false quando o limite já foi atingido", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 1 },
      ads: [{ status: "APPROVED" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(false);
  });

  it("EXPIRED e REJECTED não contam pro limite", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 1 },
      ads: [{ status: "EXPIRED" }, { status: "REJECTED" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(true);
  });
});
