import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/advertisers/promote", () => ({ promoteToAdvertiser: vi.fn() }));

import { POST } from "@/app/api/admin/users/[id]/promote-advertiser/route";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const authMock = vi.mocked(auth);
const promoteToAdvertiserMock = vi.mocked(promoteToAdvertiser);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/users/user-1/promote-advertiser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const VALID_BODY = {
  companyName: "Empresa LTDA",
  contactEmail: "contato@empresa.com",
  contactPhone: "+5511999999999",
};

describe("POST /api/admin/users/[id]/promote-advertiser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin Geral" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(403);
    expect(promoteToAdvertiserMock).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido", async () => {
    const res = await POST(
      makeRequest({ companyName: "A", contactEmail: "não-é-email", contactPhone: "" }),
      { params: Promise.resolve({ id: "user-1" }) },
    );
    expect(res.status).toBe(400);
    expect(promoteToAdvertiserMock).not.toHaveBeenCalled();
  });

  it("repassa o erro/status retornado por promoteToAdvertiser quando falha", async () => {
    promoteToAdvertiserMock.mockResolvedValueOnce({
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    });
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Só é possível promover usuários com papel Atleta a Anunciante");
  });

  it("retorna 200 e chama promoteToAdvertiser com os dados corretos no caminho de sucesso", async () => {
    promoteToAdvertiserMock.mockResolvedValueOnce({ ok: true });
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(200);
    expect(promoteToAdvertiserMock).toHaveBeenCalledWith({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
      promotedByName: "Admin Geral",
    });
  });
});
