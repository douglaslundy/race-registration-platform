import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ads/expire-private-ads", () => ({ expirePrivateAds: vi.fn() }));

import { POST } from "@/app/api/cron/expire-private-ads/route";
import { expirePrivateAds } from "@/lib/ads/expire-private-ads";

function makeRequest(secret?: string) {
  return new Request("http://localhost/api/cron/expire-private-ads", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }) as any;
}

describe("POST /api/cron/expire-private-ads", () => {
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
    expect(expirePrivateAds).not.toHaveBeenCalled();
  });

  it("chama expirePrivateAds e retorna os totais", async () => {
    vi.mocked(expirePrivateAds).mockResolvedValueOnce({ expired: 5 });
    const res = await POST(makeRequest("shh"));
    const body = await res.json();
    expect(expirePrivateAds).toHaveBeenCalled();
    expect(body).toEqual({ expired: 5 });
  });
});
