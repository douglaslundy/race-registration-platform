import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSocialPromoText } from "@/lib/event-social-links";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("getSocialPromoText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna string vazia quando não há links ativos", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
  });

  it("inclui um link ainda dentro do limite e incrementa a contagem", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue a gente no Instagram!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 1 }),
        upsert: vi.fn().mockResolvedValueOnce({}),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue a gente no Instagram! https://instagram.com/corrida");
    expect(tx.socialLinkSend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventSocialLinkId_userId: { eventSocialLinkId: "link-1", userId: "user-1" } },
        create: { eventSocialLinkId: "link-1", userId: "user-1", count: 1 },
        update: { count: { increment: 1 } },
      }),
    );
  });

  it("pula um link que já bateu o limite, sem incrementar", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 2 }),
        upsert: vi.fn(),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
    expect(tx.socialLinkSend.upsert).not.toHaveBeenCalled();
  });

  it("concatena vários links que ainda estão dentro do limite, com uma linha em branco entre eles", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 5 },
      { id: "link-2", message: "Bora no Strava!", url: "https://strava.com/routes/1", maxSends: 5 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue no Insta! https://instagram.com/corrida\n\nBora no Strava! https://strava.com/routes/1");
  });

  it("com bypassQuota: inclui os links mesmo se o atleta já bateu o limite, sem checar nem incrementar", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 1 },
    ]);

    const result = await getSocialPromoText("event-1", "user-1", { bypassQuota: true });

    expect(result).toBe("Segue no Insta! https://instagram.com/corrida");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("com bypassQuota: concatena vários links sem tocar na cota", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 1 },
      { id: "link-2", message: "Bora no Strava!", url: "https://strava.com/routes/1", maxSends: 1 },
    ]);

    const result = await getSocialPromoText("event-1", "user-1", { bypassQuota: true });

    expect(result).toBe("Segue no Insta! https://instagram.com/corrida\n\nBora no Strava! https://strava.com/routes/1");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("busca só links ativos do evento", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    await getSocialPromoText("event-1", "user-1");

    expect(dbMock.eventSocialLink.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
    });
  });
});
