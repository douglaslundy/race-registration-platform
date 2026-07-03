import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
}));

import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lança erro quando o WhatsApp não está configurado, sem chamar o cliente", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!")).rejects.toThrow("WhatsApp não configurado");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("delega para sendTextMessage com a config resolvida quando configurado", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);

    await sendWhatsAppMessage("5511999999999", "Olá!");

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
  });
});
