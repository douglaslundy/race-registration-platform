import { beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreate = vi.fn();
vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}));
vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return { ...actual, getTwilioConfig: vi.fn() };
});

import { TwilioSender, classifyTwilioError } from "@/lib/whatsapp/twilio-client";
import { WhatsAppSendError } from "@/lib/whatsapp/errors";

const CFG = { accountSid: "AC1", authToken: "tok", fromNumber: "+5511999999999", contentSid: "HX1" };

describe("TwilioSender.sendText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chama messages.create com o template utilitário e o texto na variável 1", async () => {
    messagesCreate.mockResolvedValueOnce({ sid: "SM123" });
    const sender = new TwilioSender(CFG);
    const r = await sender.sendText("5511988887777", "Olá Maria", { messageType: "ORDER_CONFIRMED" });

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "whatsapp:+5511999999999",
        to: "whatsapp:+5511988887777",
        contentSid: "HX1",
        contentVariables: JSON.stringify({ "1": "Olá Maria" }),
      }),
    );
    expect(r).toEqual({ providerMessageId: "SM123" });
  });

  it("erro de auth (code 20003) → WhatsAppSendError kind AUTH, sem vazar a mensagem crua", async () => {
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error("Authenticate error blah"), { code: 20003, status: 401 }));
    const sender = new TwilioSender(CFG);
    await expect(sender.sendText("5511988887777", "x", {})).rejects.toMatchObject({
      name: "WhatsAppSendError",
      kind: "AUTH",
    });
  });

  it("sendMedia cai no fallback: envia a legenda como texto", async () => {
    messagesCreate.mockResolvedValueOnce({ sid: "SM999" });
    const sender = new TwilioSender(CFG);
    const r = await sender.sendMedia("5511988887777", "BASE64", "kit.png", "Seu QR", "image", {});
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ contentVariables: JSON.stringify({ "1": "Seu QR" }) }),
    );
    expect(r).toEqual({ providerMessageId: "SM999" });
  });

  it("isConfigured false com campo faltando", () => {
    expect(new TwilioSender({ ...CFG, contentSid: "" }).isConfigured()).toBe(false);
  });
});

describe("classifyTwilioError", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ code: 20003 }, "AUTH"],
    [{ code: 21211 }, "INVALID_NUMBER"],
    [{ code: 21614 }, "INVALID_NUMBER"],
    [{ code: 63016 }, "INVALID_TEMPLATE"],
    [{ code: 63018 }, "INVALID_TEMPLATE"],
    [{ code: 20429 }, "RATE_LIMITED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ status: 503 }, "PROVIDER_UNAVAILABLE"],
    [{ code: "ETIMEDOUT" }, "TIMEOUT"],
    [{ code: 99999 }, "UNKNOWN"],
  ];
  it.each(cases)("%o → %s", (err, kind) => {
    const e = classifyTwilioError(Object.assign(new Error("raw twilio text"), err));
    expect(e).toBeInstanceOf(WhatsAppSendError);
    expect(e.kind).toBe(kind);
    expect(e.message).not.toContain("raw twilio text");
  });
});
