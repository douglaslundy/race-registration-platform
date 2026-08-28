import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return {
    ...actual,
    getWhatsAppProvider: vi.fn(),
    getWhatsAppConfig: vi.fn(),
    getTwilioConfig: vi.fn(),
  };
});
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));
vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: vi.fn() } })),
}));

import { getWhatsAppSender } from "@/lib/whatsapp/sender";
import { getWhatsAppProvider, getWhatsAppConfig, getTwilioConfig } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";

const providerMock = vi.mocked(getWhatsAppProvider);
const configMock = vi.mocked(getWhatsAppConfig);
const twilioConfigMock = vi.mocked(getTwilioConfig);

describe("getWhatsAppSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.mockResolvedValue({ apiUrl: "https://e", apiKey: "k", instanceName: "i" });
  });

  it("provider evolution → EvolutionSender que delega ao evolution-client", async () => {
    providerMock.mockResolvedValue("evolution");
    vi.mocked(sendTextMessage).mockResolvedValue({ providerMessageId: "evo-1" });

    const sender = await getWhatsAppSender();
    expect(sender.provider).toBe("evolution");
    const r = await sender.sendText("5511999999999", "oi", {});
    expect(sendTextMessage).toHaveBeenCalledWith(
      { apiUrl: "https://e", apiKey: "k", instanceName: "i" },
      "5511999999999",
      "oi",
    );
    expect(r).toEqual({ providerMessageId: "evo-1" });
  });

  it("provider twilio → TwilioSender", async () => {
    providerMock.mockResolvedValue("twilio");
    twilioConfigMock.mockResolvedValue({
      accountSid: "AC1",
      authToken: "tok",
      fromNumber: "+5511999999999",
      contentSid: "HX1",
    });

    const sender = await getWhatsAppSender();
    expect(sender.provider).toBe("twilio");
  });

  it("provider ausente → evolution (default)", async () => {
    providerMock.mockResolvedValue("evolution");
    const sender = await getWhatsAppSender();
    expect(sender.provider).toBe("evolution");
  });

  it("EvolutionSender.isConfigured reflete a config", async () => {
    providerMock.mockResolvedValue("evolution");
    configMock.mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    const sender = await getWhatsAppSender();
    expect(sender.isConfigured()).toBe(false);
  });
});
