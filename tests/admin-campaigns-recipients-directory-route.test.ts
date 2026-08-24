import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as DIRECTORY } from "@/app/api/admin/campaigns/recipients-directory/route";
import { GET as DIRECTORY_IDS } from "@/app/api/admin/campaigns/recipients-directory/ids/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(url: string) {
  return new Request(url) as any;
}

describe("GET /api/admin/campaigns/recipients-directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.count.mockResolvedValue(0);
  });

  it("lista atletas elegíveis (role ATHLETE, ativo, com consentimento), paginado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", name: "Maria", email: "maria@example.com", athleteProfile: { phone: "5511999999999" } },
    ]);
    dbMock.user.count.mockResolvedValueOnce(1);

    const res = await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, receivePromotionalMessages: true },
      }),
    );
    expect(data.rows).toEqual([{ id: "athlete-1", name: "Maria", email: "maria@example.com", phone: "5511999999999" }]);
    expect(data.total).toBe(1);
  });

  it("filtra por busca (nome/e-mail/telefone) quando q é informado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory?q=maria"));

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "maria", mode: "insensitive" } },
            { email: { contains: "maria", mode: "insensitive" } },
            { athleteProfile: { phone: { contains: "maria", mode: "insensitive" } } },
          ],
        }),
      }),
    );
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory"));

    expect(res.status).toBe(403);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/campaigns/recipients-directory/ids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("devolve só os ids que batem com o filtro, sem paginação", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([{ id: "athlete-1" }, { id: "athlete-2" }]);

    const res = await DIRECTORY_IDS(makeRequest("http://localhost/api/admin/campaigns/recipients-directory/ids"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ids).toEqual(["athlete-1", "athlete-2"]);
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, receivePromotionalMessages: true },
        select: { id: true },
      }),
    );
  });
});
