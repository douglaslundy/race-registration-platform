import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), getAppName: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn() }));

import { POST } from "@/app/api/admin/seo/generate/route";
import { auth } from "@/lib/auth";
import { getSetting, getAppName } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";

const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/seo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/seo/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAppName).mockResolvedValue("Circuito das Corridas");
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ field: "metaTitle" }));
    expect(res.status).toBe(403);
  });

  it("retorna 400 com field inválido", async () => {
    const res = await POST(makeRequest({ field: "banana" }));
    expect(res.status).toBe(400);
  });

  it("retorna 502 quando o provedor de IA falha", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockRejectedValueOnce(new Error("Chave de API do Claude não configurada")),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }));
    expect(res.status).toBe(502);
  });

  it("retorna 200 com o texto gerado e truncado", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockResolvedValueOnce("a".repeat(200)),
    });
    const res = await POST(makeRequest({ field: "metaDescription" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toHaveLength(160);
  });
});
