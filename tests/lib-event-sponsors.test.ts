import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("getSponsorPromoText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna string vazia quando não há patrocinadores ativos", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("");
  });

  it("inclui um patrocinador ativo", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([
      { id: "sponsor-1", name: "ACME", message: "Confira nosso patrocinador ACME!", url: "https://acme.com" },
    ]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("Confira nosso patrocinador ACME! https://acme.com");
  });

  it("junta vários patrocinadores ativos com linha em branco entre eles", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([
      { id: "sponsor-1", name: "ACME", message: "Confira a ACME!", url: "https://acme.com" },
      { id: "sponsor-2", name: "Beta", message: "Confira a Beta!", url: "https://beta.com" },
    ]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("Confira a ACME! https://acme.com\n\nConfira a Beta! https://beta.com");
  });

  it("busca só patrocinadores ativos do evento, ordenados por criação", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([]);

    await getSponsorPromoText("event-1");

    expect(dbMock.eventSponsor.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("retorna string vazia (não lança) quando a busca no banco falha", async () => {
    dbMock.eventSponsor.findMany.mockRejectedValueOnce(new Error("db down"));

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("");
  });
});
