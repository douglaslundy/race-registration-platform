import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/lib/email", () => ({ sendSensitiveActionCodeEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import { requestSensitiveActionCode, verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendSensitiveActionCodeEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

describe("requestSensitiveActionCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 2 });
    dbMock.user.findUnique.mockResolvedValue({ name: "Admin", email: "admin@example.com", phone: "5511999999999" });
    dbMock.sensitiveActionCode.create.mockResolvedValue({ id: "code-1" });
  });

  it("gera o código, grava só o hash (nunca o texto puro) e envia por e-mail e WhatsApp", async () => {
    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result).toEqual({ ok: true, verificationId: "code-1" });
    expect(dbMock.sensitiveActionCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" }),
      }),
    );
    const createCall = dbMock.sensitiveActionCode.create.mock.calls[0][0];
    expect(createCall.data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sendSensitiveActionCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", name: "Admin" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.any(String),
      "SENSITIVE_ACTION_CODE",
      expect.objectContaining({ logSubject: expect.any(String) }),
    );
  });

  it("passa o actionLabel como logSubject pro WhatsApp, para o código nunca aparecer no subject do log de mensagens", async () => {
    await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    const call = vi.mocked(sendWhatsAppMessage).mock.calls[0];
    const [, text, , options] = call;
    const code = /Seu código de verificação é: (\d{6})/.exec(text as string)?.[1];
    expect(code).toBeTruthy();
    expect(options?.logSubject).toBe("Confirmação de estorno de pagamento");
    expect(options?.logSubject).not.toContain(code);
  });

  it("não envia WhatsApp quando o usuário não tem telefone cadastrado, mas ainda retorna ok", async () => {
    dbMock.user.findUnique.mockResolvedValue({ name: "Admin", email: "admin@example.com", phone: null });

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(true);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("continua retornando ok quando o WhatsApp falha, desde que o e-mail tenha sido enviado", async () => {
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("evolution down"));

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(true);
  });

  it("não gera código (e apaga o registro criado) quando o e-mail falha", async () => {
    vi.mocked(sendSensitiveActionCodeEmail).mockRejectedValueOnce(new Error("smtp down"));

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result).toEqual({ ok: false, error: "Não foi possível enviar o código por e-mail. Tente novamente." });
    expect(dbMock.sensitiveActionCode.delete).toHaveBeenCalledWith({ where: { id: "code-1" } });
  });

  it("retorna erro sem gerar código quando o rate limit de pedidos é excedido", async () => {
    rateLimitMock.mockReturnValue({ allowed: false, remaining: 0 });

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(false);
    expect(dbMock.sensitiveActionCode.create).not.toHaveBeenCalled();
  });

  it("aceita PAYMENT_ACCOUNT_CHANGE e BACKUP_IMPORT com label pt-BR", async () => {
    const CODE = "123456";
    const crypto = await import("crypto");
    const codeHash = crypto.createHash("sha256").update(CODE).digest("hex");

    // Mock responses for request
    dbMock.sensitiveActionCode.create.mockResolvedValue({ id: "code-1" });

    // Request code for PAYMENT_ACCOUNT_CHANGE
    const requestResult = await requestSensitiveActionCode({
      userId: "user-1",
      actionType: "PAYMENT_ACCOUNT_CHANGE",
      targetId: "acc_1",
    });

    expect(requestResult.ok).toBe(true);
    expect(requestResult).toEqual({ ok: true, verificationId: "code-1" });

    // Assert email was sent with correct actionLabel
    expect(sendSensitiveActionCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        name: "Admin",
        actionLabel: "Confirmação de alteração de conta de pagamento",
      }),
    );

    // Setup for verify
    const validRecord = {
      id: "code-1",
      userId: "user-1",
      actionType: "PAYMENT_ACCOUNT_CHANGE",
      targetId: "acc_1",
      codeHash,
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    dbMock.sensitiveActionCode.findUnique.mockResolvedValue(validRecord);
    dbMock.sensitiveActionCode.update.mockResolvedValue({ ...validRecord, consumedAt: new Date() });

    // Verify code
    const verifyResult = await verifySensitiveActionCode({
      verificationId: "code-1",
      userId: "user-1",
      actionType: "PAYMENT_ACCOUNT_CHANGE",
      targetId: "acc_1",
      code: CODE,
    });

    expect(verifyResult.ok).toBe(true);
  });
});

describe("verifySensitiveActionCode", () => {
  const CODE = "123456";
  let validRecord: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const crypto = await import("crypto");
    validRecord = {
      id: "code-1",
      userId: "user-1",
      actionType: "PAYMENT_REFUND",
      targetId: "payment-1",
      codeHash: crypto.createHash("sha256").update(CODE).digest("hex"),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
  });

  it("aceita o código correto e marca como consumido", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);
    dbMock.sensitiveActionCode.update.mockResolvedValueOnce({ ...validRecord, consumedAt: new Date() });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.sensitiveActionCode.update).toHaveBeenCalledWith({
      where: { id: "code-1" },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("rejeita código errado e incrementa as tentativas", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);
    dbMock.sensitiveActionCode.update.mockResolvedValueOnce({ ...validRecord, attempts: 1 });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: "000000",
    });

    expect(result).toEqual({ ok: false, error: "Código incorreto.", attemptsRemaining: 4 });
    expect(dbMock.sensitiveActionCode.update).toHaveBeenCalledWith({
      where: { id: "code-1" },
      data: { attempts: { increment: 1 } },
    });
  });

  it("rejeita quando já atingiu o máximo de tentativas, com a mesma mensagem de expirado (não revela o motivo)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, attempts: 5 });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result).toEqual({ ok: false, error: "Código expirado ou inválido, solicite um novo." });
  });

  it("rejeita código expirado", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, expiresAt: new Date(Date.now() - 1000) });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita código já consumido (não pode ser reusado)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, consumedAt: new Date() });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o verificationId não existe", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(null);

    const result = await verifySensitiveActionCode({
      verificationId: "nao-existe", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o userId não bate com quem gerou o código", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "outro-user", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o targetId não bate (código gerado pra outro pagamento)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "outro-payment", code: CODE,
    });

    expect(result.ok).toBe(false);
  });
});
