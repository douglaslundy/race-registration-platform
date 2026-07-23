import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAdSlots, getAdSlot, updateAdSlot } from "@/lib/ad-slots";

const dbMock = db as any;

describe("listAdSlots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna todas as posições ordenadas por key", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ key: "A" }, { key: "B" }]);
    const result = await listAdSlots();
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({ orderBy: { key: "asc" } });
    expect(result).toEqual([{ key: "A" }, { key: "B" }]);
  });
});

describe("getAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("busca uma posição pela key", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ key: "EVENTOS_ABAIXO_BANNER", enabled: true });
    const result = await getAdSlot("EVENTOS_ABAIXO_BANNER");
    expect(dbMock.adSlot.findUnique).toHaveBeenCalledWith({ where: { key: "EVENTOS_ABAIXO_BANNER" } });
    expect(result).toEqual({ key: "EVENTOS_ABAIXO_BANNER", enabled: true });
  });

  it("retorna null quando a posição não existe", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    expect(await getAdSlot("INEXISTENTE")).toBeNull();
  });
});

describe("updateAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza só os campos informados", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", { enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" },
    });
  });

  it("permite limpar source e googleAdUnitId com null", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", { enabled: false, source: null, googleAdUnitId: null });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { enabled: false, source: null, googleAdUnitId: null },
    });
  });

  it("atualiza houseAdImageUrl e houseAdTargetUrl", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
      houseAdTargetUrl: "https://empresa.com",
    });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: {
        source: "HOUSE",
        houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
        houseAdTargetUrl: "https://empresa.com",
      },
    });
  });
});
