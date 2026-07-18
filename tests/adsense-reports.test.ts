import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDailyAdUnitReport } from "@/lib/ads/adsense-reports";

describe("fetchDailyAdUnitReport", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("monta a query certa e mapeia a primeira linha do relatório", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ cells: [{ value: "1500" }, { value: "12" }, { value: "3450000" }] }],
        totals: { cells: [{ value: "1500" }, { value: "12" }, { value: "3450000" }] },
        averages: { cells: [] },
        headers: [
          { name: "IMPRESSIONS" }, { name: "CLICKS" }, { name: "ESTIMATED_EARNINGS" },
        ],
      }),
    });

    const date = new Date("2026-07-18T00:00:00.000Z");
    const result = await fetchDailyAdUnitReport({
      accessToken: "at-1",
      publisherId: "pub-123",
      adUnitId: "1234567890",
      date,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://adsense.googleapis.com/v2/accounts/pub-123/reports:generate"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer at-1" }) }),
    );
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain("dateRange=CUSTOM");
    expect(calledUrl).toContain("startDate.year=2026");
    expect(calledUrl).toContain("filters=AD_UNIT_ID%3D%3D1234567890");

    expect(result).toEqual({
      impressions: 1500,
      clicks: 12,
      estimatedRevenueMicros: 3450000n,
      currency: "BRL",
    });
  });

  it("retorna null quando não há nenhuma linha no relatório (sem tráfego no dia)", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
    const result = await fetchDailyAdUnitReport({
      accessToken: "at-1", publisherId: "pub-123", adUnitId: "123", date: new Date(),
    });
    expect(result).toBeNull();
  });

  it("lança erro quando a API retorna status de erro", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
    await expect(
      fetchDailyAdUnitReport({ accessToken: "expired", publisherId: "pub-123", adUnitId: "123", date: new Date() }),
    ).rejects.toThrow();
  });
});
