import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const dbMock = db as any;

describe("promoteToAdvertiser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna erro quando o usuário não existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: false, error: "Usuário não encontrado", status: 404 });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna erro quando o usuário não tem papel ATHLETE", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "ORGANIZER" });

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("atualiza o papel, cria o AdvertiserProfile e registra auditoria numa única transação", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "ATHLETE" });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADVERTISER" },
    });
    expect(dbMock.advertiserProfile.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        companyName: "Empresa LTDA",
        contactEmail: "contato@empresa.com",
        contactPhone: "+5511999999999",
      },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "USER_UPDATED",
        entityType: "User",
        entityId: "user-1",
        metadata: { role: "ADVERTISER", companyName: "Empresa LTDA" },
      },
    });
  });
});
