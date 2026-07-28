import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn() }));

import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { hasValidMxRecord } from "@/lib/validate-email-domain";

const dbMock = db as any;

const PROFILE_INPUT = {
  companyName: "Empresa X",
  document: "111.444.777-35",
  address: "Rua Teste, 123",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
  instagram: "@empresax",
  facebook: null,
};

describe("requestAdvertiserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidMxRecord).mockResolvedValue(true);
  });

  it("cria conta nova (ATHLETE) + AdvertiserProfile quando não há sessão", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));
    dbMock.user.create.mockResolvedValueOnce({ id: "user-1", email: "novo@example.com" });
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.advertiserProfile.create.mockResolvedValueOnce({ id: "adv-1" });

    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: true, userId: "user-1", advertiserId: "adv-1" });
    expect(dbMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "novo@example.com", role: "ATHLETE" }) }),
    );
  });

  it("retorna erro quando o e-mail da conta nova já existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "existing" });

    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "ja-existe@example.com", password: "senha1234" },
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: false, error: "E-mail já cadastrado", status: 409 });
  });

  it("retorna erro quando o documento (CPF/CNPJ) é inválido", async () => {
    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: { ...PROFILE_INPUT, document: "000.000.000-00" },
    });

    expect(result).toEqual({ ok: false, error: "CPF ou CNPJ inválido", status: 400 });
  });

  it("reaproveita usuário já logado (não cria conta nova, não cria AdvertiserProfile duplicado)", async () => {
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "adv-existente" });
    dbMock.advertiserProfile.update.mockResolvedValueOnce({ id: "adv-existente" });

    const result = await requestAdvertiserAccount({
      existingUserId: "user-logado",
      newAccount: null,
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: true, userId: "user-logado", advertiserId: "adv-existente" });
    expect(dbMock.advertiserProfile.update).toHaveBeenCalledWith({
      where: { id: "adv-existente" },
      data: expect.objectContaining({ companyName: "Empresa X" }),
    });
    expect(dbMock.advertiserProfile.create).not.toHaveBeenCalled();
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });
});
