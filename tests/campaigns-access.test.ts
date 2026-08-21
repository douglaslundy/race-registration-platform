import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasCampaignsAccess } from "@/lib/campaigns/access";

const dbMock = db as any;

describe("hasCampaignsAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna true quando actingAsAdmin é true, sem consultar o banco", async () => {
    const result = await hasCampaignsAccess({ actingAsAdmin: true, organizerId: null });

    expect(result).toBe(true);
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna true quando o organizador tem campaignsEnabled=true", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ campaignsEnabled: true });

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(true);
    expect(dbMock.organizerProfile.findUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { campaignsEnabled: true },
    });
  });

  it("retorna false quando o organizador tem campaignsEnabled=false", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ campaignsEnabled: false });

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(false);
  });

  it("retorna false quando organizerId é null, sem consultar o banco", async () => {
    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: null });

    expect(result).toBe(false);
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna false quando o organizerProfile não é encontrado", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(false);
  });
});
