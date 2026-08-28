import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp/sender", () => ({ getWhatsAppSender: vi.fn() }));

import {
  sendWhatsAppMessage,
  sendWhatsAppDocument,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
} from "@/lib/whatsapp";
import { getWhatsAppSender } from "@/lib/whatsapp/sender";
import { WhatsAppSendError } from "@/lib/whatsapp/errors";

const dbMock = db as any;
const senderMock = vi.mocked(getWhatsAppSender);

function fakeSender(
  over: Partial<{ sendText: any; sendMedia: any; isConfigured: any; provider: any }> = {},
) {
  return {
    provider: over.provider ?? ("twilio" as const),
    sendText: over.sendText ?? vi.fn().mockResolvedValue({ providerMessageId: "SM1" }),
    sendMedia: over.sendMedia ?? vi.fn().mockResolvedValue({ providerMessageId: null }),
    isConfigured: over.isConfigured ?? (() => true),
  };
}

/** Data do último db.messageLog.create (recordMessageLog roda de verdade aqui). */
function lastLoggedData() {
  return dbMock.messageLog.create.mock.calls.at(-1)[0].data;
}

describe("normalizePhoneForWhatsApp", () => {
  it("adiciona o DDI 55 quando o número local não tem código de país (celular, 11 dígitos)", () => {
    expect(normalizePhoneForWhatsApp("11999999999")).toBe("5511999999999");
  });

  it("adiciona o DDI 55 quando o número local não tem código de país (fixo, 10 dígitos)", () => {
    expect(normalizePhoneForWhatsApp("1133334444")).toBe("551133334444");
  });

  it("não duplica o DDI quando o número já vem com 55 (celular)", () => {
    expect(normalizePhoneForWhatsApp("5511999999999")).toBe("5511999999999");
  });

  it("não duplica o DDI quando o número já vem com 55 (fixo)", () => {
    expect(normalizePhoneForWhatsApp("551133334444")).toBe("551133334444");
  });

  it("remove formatação e o + antes de normalizar", () => {
    expect(normalizePhoneForWhatsApp("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(normalizePhoneForWhatsApp("(11) 99999-9999")).toBe("5511999999999");
  });

  it("devolve só os dígitos sem alterar quando o formato é inesperado", () => {
    expect(normalizePhoneForWhatsApp("123")).toBe("123");
  });
});

describe("isValidWhatsAppPhone", () => {
  it("aceita um celular normalizado (DDI 55 + 11 dígitos)", () => {
    expect(isValidWhatsAppPhone("5511999999999")).toBe(true);
  });

  it("aceita um fixo normalizado (DDI 55 + 10 dígitos)", () => {
    expect(isValidWhatsAppPhone("551133334444")).toBe(true);
  });

  it("rejeita string vazia", () => {
    expect(isValidWhatsAppPhone("")).toBe(false);
  });

  it("rejeita telefone sem DDI 55", () => {
    expect(isValidWhatsAppPhone("11999999999")).toBe(false);
  });

  it("rejeita telefone claramente curto demais", () => {
    expect(isValidWhatsAppPhone("5511999")).toBe(false);
  });

  it("rejeita telefone longo demais", () => {
    expect(isValidWhatsAppPhone("551199999999999")).toBe(false);
  });
});

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.create.mockResolvedValue({});
    dbMock.user.findFirst.mockResolvedValue(null);
  });

  it("lança erro quando o sender não está configurado, sem enviar nem logar", async () => {
    const sender = fakeSender({ isConfigured: () => false });
    senderMock.mockResolvedValue(sender as any);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!", "TEST")).rejects.toThrow(
      /não configurado/i,
    );
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(dbMock.messageLog.create).not.toHaveBeenCalled();
  });

  it("envia pelo sender ativo e grava MessageLog SENT com providerMessageId", async () => {
    const sender = fakeSender({ sendText: vi.fn().mockResolvedValue({ providerMessageId: "SM1" }) });
    senderMock.mockResolvedValue(sender as any);

    const r = await sendWhatsAppMessage("11988887777", "oi", "ORDER_CONFIRMED");

    expect(sender.sendText).toHaveBeenCalledWith("5511988887777", "oi", { messageType: "ORDER_CONFIRMED" });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: "WHATSAPP",
          messageType: "ORDER_CONFIRMED",
          subject: "oi",
          recipientAddress: "5511988887777",
          status: "SENT",
          providerMessageId: "SM1",
        }),
      }),
    );
    expect(r).toEqual({ providerMessageId: "SM1" });
  });

  it("normaliza o telefone (adiciona o DDI 55) antes de enviar e de registrar o log", async () => {
    const sender = fakeSender({ sendText: vi.fn().mockResolvedValue({ providerMessageId: "SM1" }) });
    senderMock.mockResolvedValue(sender as any);

    await sendWhatsAppMessage("11999999999", "Olá!", "TEST");

    expect(sender.sendText).toHaveBeenCalledWith("5511999999999", "Olá!", { messageType: "TEST" });
    expect(lastLoggedData()).toMatchObject({ recipientAddress: "5511999999999" });
  });

  it("grava relatedEntityType/relatedEntityId no log quando informados", async () => {
    senderMock.mockResolvedValue(fakeSender() as any);

    await sendWhatsAppMessage("5511999999999", "Olá!", "TEST", {
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });

    expect(lastLoggedData()).toMatchObject({
      status: "SENT",
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });
  });

  it("trunca o texto em ~80 caracteres pro subject do log", async () => {
    senderMock.mockResolvedValue(fakeSender({ sendText: vi.fn().mockResolvedValue({ providerMessageId: null }) }) as any);
    const longText = "a".repeat(120);

    await sendWhatsAppMessage("5511999999999", longText, "TEST");

    expect(lastLoggedData().subject).toBe(`${"a".repeat(77)}...`);
  });

  it("usa options.logSubject como subject do log (em vez do texto truncado) sem alterar o texto enviado", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);
    const text = "Confirmação de estorno\n\nSeu código de verificação é: 123456\n\nVálido por 10 minutos.";

    await sendWhatsAppMessage("5511999999999", text, "SENSITIVE_ACTION_CODE", {
      logSubject: "Confirmação de estorno",
    });

    expect(sender.sendText).toHaveBeenCalledWith("5511999999999", text, {
      messageType: "SENSITIVE_ACTION_CODE",
    });
    expect(lastLoggedData().subject).toBe("Confirmação de estorno");
    expect(lastLoggedData().subject).not.toContain("123456");
  });

  it("em caso de falha comum no envio, registra o log como FAILED e relança o erro original", async () => {
    const err = new Error("Evolution API 400 ao enviar mensagem");
    senderMock.mockResolvedValue(fakeSender({ sendText: vi.fn().mockRejectedValue(err) }) as any);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!", "TEST")).rejects.toBe(err);

    expect(lastLoggedData()).toMatchObject({
      status: "FAILED",
      errorMessage: "Evolution API 400 ao enviar mensagem",
    });
  });

  it("erro do sender (WhatsAppSendError) → MessageLog FAILED com errorMessage seguro (kind+label), e re-lança", async () => {
    const sender = fakeSender({
      sendText: vi.fn().mockRejectedValue(new WhatsAppSendError("INVALID_NUMBER", "falha crua do provider", "21211")),
    });
    senderMock.mockResolvedValue(sender as any);

    await expect(sendWhatsAppMessage("11988887777", "oi", "ORDER_CONFIRMED")).rejects.toBeInstanceOf(
      WhatsAppSendError,
    );

    const logged = lastLoggedData();
    expect(logged.status).toBe("FAILED");
    expect(logged.errorMessage).toMatch(/INVALID_NUMBER/);
    expect(logged.errorMessage).not.toContain("21211");
    expect(logged.errorMessage).not.toContain("falha crua do provider");
    expect(logged.errorMessage).not.toMatch(/token|sid/i);
  });

  it("quando appendPreferencesFooter é true, acrescenta o rodapé de preferências ao texto enviado e ao log", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const expectedText =
      `Sua inscrição foi confirmada!\n\nPara alterar ou cancelar o recebimento de mensagens, acesse suas preferências de comunicação: ${baseUrl}/preferencias`;

    await sendWhatsAppMessage("5511999999999", "Sua inscrição foi confirmada!", "ORDER_CONFIRMED", {
      appendPreferencesFooter: true,
    });

    expect(sender.sendText).toHaveBeenCalledWith("5511999999999", expectedText, {
      messageType: "ORDER_CONFIRMED",
    });
    expect(lastLoggedData().subject).toBe(
      expectedText.length > 80 ? `${expectedText.slice(0, 77)}...` : expectedText,
    );
  });

  it("sem appendPreferencesFooter (ausente ou false), não altera o texto enviado", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);

    await sendWhatsAppMessage("5511999999999", "Olá!", "TEST", { appendPreferencesFooter: false });

    expect(sender.sendText).toHaveBeenCalledWith("5511999999999", "Olá!", { messageType: "TEST" });
  });

  it("devolve o providerMessageId em caso de sucesso", async () => {
    senderMock.mockResolvedValue(
      fakeSender({ sendText: vi.fn().mockResolvedValue({ providerMessageId: "wamid.123" }) }) as any,
    );
    const result = await sendWhatsAppMessage("11999999999", "Olá");
    expect(result).toEqual({ providerMessageId: "wamid.123" });
  });

  it("devolve providerMessageId undefined quando o provider não retorna id", async () => {
    senderMock.mockResolvedValue(
      fakeSender({ sendText: vi.fn().mockResolvedValue({ providerMessageId: null }) }) as any,
    );
    const result = await sendWhatsAppMessage("11999999999", "Olá");
    expect(result).toEqual({ providerMessageId: undefined });
  });
});

describe("sendWhatsAppDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.create.mockResolvedValue({});
    dbMock.user.findFirst.mockResolvedValue(null);
  });

  it("lança erro quando o sender não está configurado, sem enviar nem logar", async () => {
    const sender = fakeSender({ isConfigured: () => false });
    senderMock.mockResolvedValue(sender as any);

    await expect(
      sendWhatsAppDocument("5511999999999", "base64PdfContent", "relatorio.pdf", "Seu relatório"),
    ).rejects.toThrow(/não configurado/i);
    expect(sender.sendMedia).not.toHaveBeenCalled();
    expect(dbMock.messageLog.create).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, delega pro sender com os parâmetros certos e registra o log como SENT", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);

    await sendWhatsAppDocument("5511999999999", "base64PdfContent", "relatorio.pdf", "Seu relatório");

    expect(sender.sendMedia).toHaveBeenCalledWith(
      "5511999999999",
      "base64PdfContent",
      "relatorio.pdf",
      "Seu relatório",
      "document",
      { messageType: undefined },
    );
    expect(lastLoggedData()).toMatchObject({
      channel: "WHATSAPP",
      messageType: null,
      subject: "Seu relatório",
      recipientAddress: "5511999999999",
      status: "SENT",
    });
  });

  it("grava messageType/relatedEntityType/relatedEntityId no log quando informados via options", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);

    await sendWhatsAppDocument(
      "5511999999999",
      "base64PdfContent",
      "qrcode-retirada-kit.png",
      "Apresente este QR code na retirada do kit",
      { messageType: "ORDER_CONFIRMED", relatedEntityType: "Event", relatedEntityId: "event-1" },
    );

    expect(sender.sendMedia).toHaveBeenCalledWith(
      "5511999999999",
      "base64PdfContent",
      "qrcode-retirada-kit.png",
      "Apresente este QR code na retirada do kit",
      "document",
      { messageType: "ORDER_CONFIRMED" },
    );
    expect(lastLoggedData()).toMatchObject({
      messageType: "ORDER_CONFIRMED",
      subject: "Apresente este QR code na retirada do kit",
      recipientAddress: "5511999999999",
      status: "SENT",
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });
  });

  it("repassa mediatype 'image' pro sender quando informado via options, sem afetar o log", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);

    await sendWhatsAppDocument(
      "5511999999999",
      "base64PngContent",
      "qrcode-retirada-kit.png",
      "Apresente este QR code na retirada do kit",
      { mediatype: "image" },
    );

    expect(sender.sendMedia).toHaveBeenCalledWith(
      "5511999999999",
      "base64PngContent",
      "qrcode-retirada-kit.png",
      "Apresente este QR code na retirada do kit",
      "image",
      { messageType: undefined },
    );
  });

  it("em caso de falha no envio, registra o log como FAILED (errorMessage seguro) e relança o erro", async () => {
    const sender = fakeSender({
      sendMedia: vi.fn().mockRejectedValue(new WhatsAppSendError("PROVIDER_UNAVAILABLE", "corpo cru", "20500")),
    });
    senderMock.mockResolvedValue(sender as any);

    await expect(
      sendWhatsAppDocument("invalid", "base64PdfContent", "relatorio.pdf", "Seu relatório"),
    ).rejects.toBeInstanceOf(WhatsAppSendError);

    const logged = lastLoggedData();
    expect(logged.status).toBe("FAILED");
    expect(logged.subject).toBe("Seu relatório");
    expect(logged.errorMessage).toMatch(/PROVIDER_UNAVAILABLE/);
    expect(logged.errorMessage).not.toContain("20500");
    expect(logged.errorMessage).not.toContain("corpo cru");
  });
});
