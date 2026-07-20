import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { expirePrivateAds } from "@/lib/ads/expire-private-ads";

const dbMock = db as any;

describe("expirePrivateAds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca como EXPIRED os PrivateAd cuja AdPurchase já venceu, sem tocar nos outros status", async () => {
    dbMock.privateAd.updateMany.mockResolvedValueOnce({ count: 3 });

    const result = await expirePrivateAds();

    expect(dbMock.privateAd.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["APPROVED", "PENDING_APPROVAL"] },
        adPurchase: { endAt: { lt: expect.any(Date) } },
      },
      data: { status: "EXPIRED" },
    });
    expect(result).toEqual({ expired: 3 });
  });
});
