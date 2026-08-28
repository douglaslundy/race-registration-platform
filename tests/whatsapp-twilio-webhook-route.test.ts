import { beforeEach, describe, expect, it, vi } from "vitest";

const { validateRequest } = vi.hoisted(() => ({ validateRequest: vi.fn() }));
vi.mock("twilio", () => ({ default: Object.assign(vi.fn(), { validateRequest }) }));
vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return { ...actual, getTwilioConfig: vi.fn() };
});
vi.mock("@/lib/message-logs", () => ({ updateMessageLogStatusByProviderMessageId: vi.fn() }));
vi.mock("@/lib/campaigns/delivery-status", () => ({ updateCampaignRecipientStatusByProviderMessageId: vi.fn() }));

import { POST } from "@/app/api/webhooks/whatsapp/twilio/route";
import { getTwilioConfig } from "@/lib/whatsapp-settings";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request("http://localhost/api/webhooks/whatsapp/twilio", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": "sig" },
    body,
  }) as any;
}

describe("POST /api/webhooks/whatsapp/twilio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTwilioConfig).mockResolvedValue({ accountSid: "AC1", authToken: "tok", fromNumber: "+55", contentSid: "HX" });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  });

  it("assinatura inválida → 403", async () => {
    validateRequest.mockReturnValue(false);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(403);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("authToken vazio → 403 (fail closed)", async () => {
    vi.mocked(getTwilioConfig).mockResolvedValue({ accountSid: "", authToken: "", fromNumber: "", contentSid: "" });
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(403);
  });

  it("delivered → DELIVERED", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "DELIVERED");
  });

  it("read → READ", async () => {
    validateRequest.mockReturnValue(true);
    await POST(formReq({ MessageSid: "SM1", MessageStatus: "read" }));
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "READ");
  });

  it("failed com ErrorCode → FAILED + 'Twilio <code>'", async () => {
    validateRequest.mockReturnValue(true);
    await POST(formReq({ MessageSid: "SM1", MessageStatus: "failed", ErrorCode: "63016" }));
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "FAILED", "Twilio 63016");
  });

  it("sent/queued → no-op, 200", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "sent" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });
});
