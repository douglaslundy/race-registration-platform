import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchAdSensePublisherId,
} from "@/lib/ads/adsense-oauth";

const originalEnv = { ...process.env };

describe("buildGoogleAuthUrl", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123" };
  });

  it("monta a URL de autorização com escopo readonly e o client_id configurado", () => {
    const url = buildGoogleAuthUrl("https://app.example.com/api/admin/ads/google/callback");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/admin/ads/google/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adsense.readonly");
  });
});

describe("exchangeCodeForTokens", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret-abc" };
    global.fetch = vi.fn();
  });

  it("troca o código por tokens via POST em oauth2.googleapis.com/token", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    });

    const result = await exchangeCodeForTokens("auth-code", "https://app.example.com/callback");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.accessToken).toBe("at-1");
    expect(result.refreshToken).toBe("rt-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("lança erro quando a Google rejeita a troca", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(exchangeCodeForTokens("bad-code", "https://app.example.com/callback")).rejects.toThrow();
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret-abc" };
    global.fetch = vi.fn();
  });

  it("renova o access token usando o refresh token", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 }),
    });

    const result = await refreshAccessToken("rt-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.accessToken).toBe("at-2");
  });

  it("lança erro quando o refresh falha (ex.: acesso revogado)", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(refreshAccessToken("revoked-token")).rejects.toThrow();
  });
});

describe("fetchAdSensePublisherId", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("busca a lista de contas e retorna o primeiro publisherId (formato pub-XXXX)", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accounts: [{ name: "accounts/pub-1234567890123456" }] }),
    });

    const result = await fetchAdSensePublisherId("at-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://adsense.googleapis.com/v2/accounts",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer at-1" }) }),
    );
    expect(result).toBe("pub-1234567890123456");
  });

  it("retorna null quando não há nenhuma conta", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ accounts: [] }) });
    expect(await fetchAdSensePublisherId("at-1")).toBeNull();
  });
});
