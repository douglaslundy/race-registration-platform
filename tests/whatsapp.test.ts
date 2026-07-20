import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));
vi.mock("@/lib/message-logs", () => ({
  recordMessageLog: vi.fn(),
}));

import { sendWhatsAppMessage, sendWhatsAppDocument, normalizePhoneForWhatsApp } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { sendTextMessage, sendMediaMessage } from "@/lib/whatsapp/evolution-client";
import { recordMessageLog } from "@/lib/message-logs";

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

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lança erro quando o WhatsApp não está configurado, sem chamar o cliente nem logar", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!")).rejects.toThrow("WhatsApp não configurado");
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, delega pro cliente e registra o log com o providerMessageId", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.abc" });

    await sendWhatsAppMessage("5511999999999", "Olá!");

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "WHATSAPP",
      subject: "Olá!",
      recipientAddress: "5511999999999",
      status: "SENT",
      providerMessageId: "wamid.abc",
    });
  });

  it("normaliza o telefone (adiciona o DDI 55) antes de enviar e de registrar o log", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.abc" });

    await sendWhatsAppMessage("11999999999", "Olá!");

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
    expect(recordMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAddress: "5511999999999" }),
    );
  });

  it("trunca o texto em ~80 caracteres pro subject do log", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: null });
    const longText = "a".repeat(120);

    await sendWhatsAppMessage("5511999999999", longText);

    expect(recordMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ subject: `${"a".repeat(77)}...` }),
    );
  });

  it("em caso de falha no envio, registra o log como FAILED e relança o erro original", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockRejectedValueOnce(new Error("Evolution API 400 ao enviar mensagem"));

    await expect(sendWhatsAppMessage("5511999999999", "Olá!")).rejects.toThrow("Evolution API 400");

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "WHATSAPP",
      subject: "Olá!",
      recipientAddress: "5511999999999",
      status: "FAILED",
      errorMessage: "Evolution API 400 ao enviar mensagem",
    });
  });
});

describe("sendWhatsAppDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lança erro quando o WhatsApp não está configurado, sem chamar o cliente", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await expect(
      sendWhatsAppDocument("5511999999999", "base64PdfContent", "relatorio.pdf", "Seu relatório"),
    ).rejects.toThrow("WhatsApp não configurado");
    expect(sendMediaMessage).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, delega pro cliente com os parâmetros certos, sem registrar no MessageLog", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendMediaMessage).mockResolvedValueOnce(undefined);

    await sendWhatsAppDocument("5511999999999", "base64PdfContent", "relatorio.pdf", "Seu relatório");

    expect(sendMediaMessage).toHaveBeenCalledWith(
      config,
      "5511999999999",
      "base64PdfContent",
      "relatorio.pdf",
      "Seu relatório",
    );
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de falha no envio, relança o erro original sem registrar no MessageLog", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendMediaMessage).mockRejectedValueOnce(new Error("Evolution API 400 ao enviar mídia"));

    await expect(
      sendWhatsAppDocument("invalid", "base64PdfContent", "relatorio.pdf", "Seu relatório"),
    ).rejects.toThrow("Evolution API 400 ao enviar mídia");
    expect(recordMessageLog).not.toHaveBeenCalled();
  });
});
