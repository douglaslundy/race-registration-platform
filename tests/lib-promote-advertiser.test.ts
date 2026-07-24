import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));
vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendAdvertiserPromotionEmail: vi.fn() }));

import { promoteToAdvertiser } from "@/lib/advertisers/promote";
import { getSetting } from "@/lib/settings";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserPromotionEmail } from "@/lib/email";

const dbMock = db as any;

describe("promoteToAdvertiser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSetting).mockResolvedValue("true");
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("retorna erro quando o marketplace de anúncios está desativado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("false");

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "Cadastro de anunciantes não está disponível no momento",
      status: 403,
    });
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

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
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      role: "ATHLETE",
      name: "João",
      email: "joao@example.com",
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
      promotedByName: "Admin Geral",
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
    expect(sendAdvertiserPromotionEmail).toHaveBeenCalledWith({
      to: "joao@example.com",
      name: "João",
      promotedByName: "Admin Geral",
    });
  });

  it("não envia e-mail quando o SMTP não está configurado", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      role: "ATHLETE",
      name: "João",
      email: "joao@example.com",
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true });
    expect(sendAdvertiserPromotionEmail).not.toHaveBeenCalled();
  });

  it("não falha a promoção se o envio do e-mail lançar erro", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      role: "ATHLETE",
      name: "João",
      email: "joao@example.com",
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));
    vi.mocked(sendAdvertiserPromotionEmail).mockRejectedValueOnce(new Error("smtp down"));

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true });
  });
});
