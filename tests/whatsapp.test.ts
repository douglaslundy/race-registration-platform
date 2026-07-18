import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
}));
vi.mock("@/lib/message-logs", () => ({
  recordMessageLog: vi.fn(),
}));

import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";
import { recordMessageLog } from "@/lib/message-logs";

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

    await expect(sendWhatsAppMessage("invalid", "Olá!")).rejects.toThrow("Evolution API 400");

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "WHATSAPP",
      subject: "Olá!",
      recipientAddress: "invalid",
      status: "FAILED",
      errorMessage: "Evolution API 400 ao enviar mensagem",
    });
  });
});
