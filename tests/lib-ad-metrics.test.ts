import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAdMetricsSummary } from "@/lib/ads/ad-metrics";

const dbMock = db as any;

describe("listAdMetricsSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agrupa snapshots por posição, somando impressões/cliques/receita no intervalo", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([
      {
        id: "s1",
        label: "Abaixo do banner",
        metrics: [
          { impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n },
          { impressions: 200, clicks: 10, estimatedRevenueMicros: 2000000n },
        ],
      },
    ]);

    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-18T00:00:00.000Z");
    const result = await listAdMetricsSummary(from, to);

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      include: { metrics: { where: { date: { gte: from, lte: to } } } },
      orderBy: { key: "asc" },
    });
    expect(result).toEqual([
      { slotLabel: "Abaixo do banner", impressions: 300, clicks: 15, estimatedRevenueMicros: 3000000n },
    ]);
  });

  it("posição sem nenhum snapshot no intervalo aparece zerada, não some da lista", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", label: "Sem tráfego", metrics: [] }]);
    const result = await listAdMetricsSummary(new Date(), new Date());
    expect(result).toEqual([{ slotLabel: "Sem tráfego", impressions: 0, clicks: 0, estimatedRevenueMicros: 0n }]);
  });
});
