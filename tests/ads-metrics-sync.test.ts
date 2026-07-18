import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), upsertSetting: vi.fn() }));
vi.mock("@/lib/ads/adsense-oauth", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("@/lib/ads/adsense-reports", () => ({ fetchDailyAdUnitReport: vi.fn() }));

import { syncAdMetrics } from "@/lib/ads/metrics-sync";
import { getSetting, upsertSetting } from "@/lib/settings";
import { refreshAccessToken } from "@/lib/ads/adsense-oauth";
import { fetchDailyAdUnitReport } from "@/lib/ads/adsense-reports";

const dbMock = db as any;
const date = new Date("2026-07-18T00:00:00.000Z");

describe("syncAdMetrics", () => {
  beforeEach(() => {
    // Note: resetAllMocks (not clearAllMocks) is required here — clearAllMocks does not
    // flush queued mockResolvedValueOnce/mockRejectedValueOnce values, so leftover once-values
    // from one test's early-return path leak into the next test's mock calls.
    vi.resetAllMocks();
    dbMock.adSlot.findMany.mockResolvedValue([]);
  });

  it("retorna 0/0 e não chama a API quando não há conexão salva (sem refresh token)", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => (key === "google_adsense_refresh_token" ? null : "pub-123"));
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);

    const result = await syncAdMetrics(date);

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(fetchDailyAdUnitReport).not.toHaveBeenCalled();
  });

  it("renova o token, busca o relatório de cada slot Google ativo e faz upsert do snapshot", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);
    vi.mocked(fetchDailyAdUnitReport).mockResolvedValueOnce({
      impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL",
    });

    const result = await syncAdMetrics(date);

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({ where: { enabled: true, source: "GOOGLE", googleAdUnitId: { not: null } } });
    expect(fetchDailyAdUnitReport).toHaveBeenCalledWith({ accessToken: "at-new", publisherId: "pub-123", adUnitId: "111", date });
    expect(dbMock.adMetricsSnapshot.upsert).toHaveBeenCalledWith({
      where: { adSlotId_date: { adSlotId: "s1", date } },
      create: { adSlotId: "s1", date, impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL" },
      update: { impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL" },
    });
    expect(result).toEqual({ synced: 1, failed: 0 });
  });

  it("marca a conexão como desconectada quando o refresh do token falha, sem quebrar o sync das outras posições", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "revoked";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error("invalid_grant"));
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);

    const result = await syncAdMetrics(date);

    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "");
    expect(fetchDailyAdUnitReport).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });

  it("conta como falha (sem derrubar as demais) quando o relatório de uma posição específica lança erro", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([
      { id: "s1", googleAdUnitId: "111" },
      { id: "s2", googleAdUnitId: "222" },
    ]);
    vi.mocked(fetchDailyAdUnitReport)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ impressions: 10, clicks: 1, estimatedRevenueMicros: 5000n, currency: "BRL" });

    const result = await syncAdMetrics(date);

    expect(result).toEqual({ synced: 1, failed: 1 });
  });

  it("quando o relatório não tem linha (sem tráfego no dia), não faz upsert e não conta como falha", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);
    vi.mocked(fetchDailyAdUnitReport).mockResolvedValueOnce(null);

    const result = await syncAdMetrics(date);

    expect(dbMock.adMetricsSnapshot.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });
});
