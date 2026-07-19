import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));
vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn(async () => true) }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { POST } from "@/app/api/auth/register-advertiser/route";
import { getSetting } from "@/lib/settings";

const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/auth/register-advertiser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  name: "Fulano",
  email: "empresa@example.com",
  password: "senha1234",
  companyName: "Empresa LTDA",
  contactEmail: "contato@empresa.com",
  contactPhone: "5511999999999",
};

describe("POST /api/auth/register-advertiser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSetting).mockResolvedValue("true");
    dbMock.user.findUnique.mockResolvedValue(null);
  });

  it("retorna 403 quando o marketplace de anúncios está desativado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("false");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido", async () => {
    const res = await POST(makeRequest({ ...validBody, email: "invalido" }));
    expect(res.status).toBe(400);
  });

  it("retorna 409 quando o e-mail já existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "existing" });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
  });

  it("cria User(role=ADVERTISER) e AdvertiserProfile com sucesso", async () => {
    dbMock.user.create.mockResolvedValueOnce({ id: "user-1", name: "Fulano", email: "empresa@example.com", role: "ADVERTISER" });
    dbMock.advertiserProfile.create.mockResolvedValueOnce({ id: "adv-1" });

    const res = await POST(makeRequest(validBody));

    expect(dbMock.user.create).toHaveBeenCalledWith({
      data: { name: "Fulano", email: "empresa@example.com", passwordHash: "hashed", role: "ADVERTISER" },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(dbMock.advertiserProfile.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        companyName: "Empresa LTDA",
        contactEmail: "contato@empresa.com",
        contactPhone: "5511999999999",
      },
    });
    expect(res.status).toBe(201);
  });
});
