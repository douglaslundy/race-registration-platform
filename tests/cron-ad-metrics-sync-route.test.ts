import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ads/metrics-sync", () => ({ syncAdMetrics: vi.fn() }));

import { POST } from "@/app/api/cron/ad-metrics-sync/route";
import { syncAdMetrics } from "@/lib/ads/metrics-sync";

function makeRequest(secret?: string) {
  return new Request("http://localhost/api/cron/ad-metrics-sync", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }) as any;
}

describe("POST /api/cron/ad-metrics-sync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "shh";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("retorna 401 com secret errado", async () => {
    const res = await POST(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(syncAdMetrics).not.toHaveBeenCalled();
  });

  it("chama syncAdMetrics com a data de ontem e retorna os totais", async () => {
    vi.mocked(syncAdMetrics).mockResolvedValueOnce({ synced: 3, failed: 1 });
    const res = await POST(makeRequest("shh"));
    const body = await res.json();
    expect(syncAdMetrics).toHaveBeenCalledWith(expect.any(Date));
    expect(body).toEqual({ synced: 3, failed: 1 });
  });
});
