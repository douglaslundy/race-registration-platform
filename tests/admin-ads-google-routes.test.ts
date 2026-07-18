import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ upsertSetting: vi.fn(), getSetting: vi.fn() }));
vi.mock("@/lib/ads/adsense-oauth", () => ({
  buildGoogleAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  fetchAdSensePublisherId: vi.fn(),
}));

import { GET as connectGet } from "@/app/api/admin/ads/google/connect/route";
import { GET as callbackGet } from "@/app/api/admin/ads/google/callback/route";
import { POST as disconnectPost } from "@/app/api/admin/ads/google/disconnect/route";
import { upsertSetting } from "@/lib/settings";
import { buildGoogleAuthUrl, exchangeCodeForTokens, fetchAdSensePublisherId } from "@/lib/ads/adsense-oauth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeCallbackRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/admin/ads/google/callback");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url) as any;
}

describe("GET /api/admin/ads/google/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await connectGet();
    expect(res.status).toBe(403);
  });

  it("redireciona pra URL de autorização da Google", async () => {
    vi.mocked(buildGoogleAuthUrl).mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    const res = await connectGet();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  });
});

describe("GET /api/admin/ads/google/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await callbackGet(makeCallbackRequest({ code: "abc" }));
    expect(res.status).toBe(403);
  });

  it("redireciona de volta pra tela de anúncios com erro quando falta o code", async () => {
    const res = await callbackGet(makeCallbackRequest({}));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/anuncios/conectar-google");
    expect(res.headers.get("location")).toContain("error");
  });

  it("troca o code por tokens, busca o publisherId, salva tudo e redireciona com sucesso", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValueOnce({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    vi.mocked(fetchAdSensePublisherId).mockResolvedValueOnce("pub-123");

    const res = await callbackGet(makeCallbackRequest({ code: "auth-code" }));

    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "at-1");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_refresh_token", "rt-1");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_publisher_id", "pub-123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/anuncios/conectar-google");
    expect(res.headers.get("location")).not.toContain("error");
  });
});

describe("POST /api/admin/ads/google/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await disconnectPost();
    expect(res.status).toBe(403);
  });

  it("limpa os tokens salvos e retorna 200", async () => {
    const res = await disconnectPost();
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_refresh_token", "");
    expect(res.status).toBe(200);
  });
});
