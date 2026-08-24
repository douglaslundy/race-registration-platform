import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/admin/campaigns/variables/route";

const authMock = vi.mocked(auth);

function makeRequest() {
  return new Request("http://localhost/api/admin/campaigns/variables") as any;
}

describe("GET /api/admin/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inclui variáveis de categoria Evento/Organizador/Inscrição pra campanha de plataforma (guarda de segurança fica pro agendar/disparar, não pro catálogo)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: { name: string }) => v.name);
    expect(names).toContain("nome_evento");
    expect(names).toContain("numero_inscricao");
    expect(names).toContain("qrcode_inscricao");
  });
});
