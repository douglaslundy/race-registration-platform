import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import sitemap from "@/app/sitemap";

const dbMock = db as any;

describe("sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://circuitodascorridas.com.br";
  });

  it("busca eventos com status publicamente visível e monta as URLs", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([
      { slug: "corrida-teste", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const result = await sitemap();

    expect(dbMock.event.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT", "REGISTRATIONS_CLOSED", "COMPLETED"] } },
      select: { slug: true, updatedAt: true },
    });

    const urls = result.map((entry) => entry.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://circuitodascorridas.com.br",
        "https://circuitodascorridas.com.br/eventos",
        "https://circuitodascorridas.com.br/termos",
        "https://circuitodascorridas.com.br/privacidade",
        "https://circuitodascorridas.com.br/eventos/corrida-teste",
      ]),
    );
  });

  it("usa event.updatedAt como lastModified do evento", async () => {
    const updatedAt = new Date("2026-03-15T12:00:00Z");
    dbMock.event.findMany.mockResolvedValueOnce([{ slug: "corrida-teste", updatedAt }]);

    const result = await sitemap();
    const eventEntry = result.find((entry) => entry.url.endsWith("/eventos/corrida-teste"));
    expect(eventEntry?.lastModified).toEqual(updatedAt);
  });
});
