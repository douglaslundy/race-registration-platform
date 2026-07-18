import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasActiveGoogleAdSlot } from "@/lib/ad-slots";

const dbMock = db as any;

describe("hasActiveGoogleAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna true quando existe ao menos 1 posição enabled com source GOOGLE", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "1" }]);
    const result = await hasActiveGoogleAdSlot();
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { enabled: true, source: "GOOGLE" },
      take: 1,
    });
    expect(result).toBe(true);
  });

  it("retorna false quando não existe nenhuma", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([]);
    expect(await hasActiveGoogleAdSlot()).toBe(false);
  });
});
