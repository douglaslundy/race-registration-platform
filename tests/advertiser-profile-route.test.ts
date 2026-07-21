import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/anunciante/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/anunciante/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  companyName: "Empresa Teste Ltda",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
};

describe("GET /api/anunciante/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("retorna o perfil do anunciante autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ companyName: "Empresa Teste" });

    const res = await GET();
    const body = await res.json();

    expect(dbMock.advertiserProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
    });
    expect(body.profile).toEqual({ companyName: "Empresa Teste" });
  });
});

describe("PUT /api/anunciante/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await PUT(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PUT(makeRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("rejeita quando falta razão social", async () => {
    const res = await PUT(makeRequest({ ...validBody, companyName: "" }));
    expect(res.status).toBe(400);
    expect(dbMock.advertiserProfile.upsert).not.toHaveBeenCalled();
  });

  it("rejeita e-mail de contato inválido", async () => {
    const res = await PUT(makeRequest({ ...validBody, contactEmail: "invalido" }));
    expect(res.status).toBe(400);
    expect(dbMock.advertiserProfile.upsert).not.toHaveBeenCalled();
  });

  it("salva os 3 campos quando válidos", async () => {
    dbMock.advertiserProfile.upsert.mockResolvedValueOnce(validBody);

    const res = await PUT(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(dbMock.advertiserProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
      create: { userId: "advertiser-user-1", ...validBody },
      update: validBody,
    });
  });
});
