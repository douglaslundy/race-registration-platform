import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/message-logs", () => ({
  updateMessageLogStatusByProviderMessageId: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

function makeRequest(secret: string | null, body: unknown) {
  const url = new URL("http://localhost/api/webhooks/whatsapp");
  if (secret !== null) url.searchParams.set("secret", secret);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/webhooks/whatsapp", () => {
  const originalSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
  });

  afterAll(() => {
    process.env.WHATSAPP_WEBHOOK_SECRET = originalSecret;
  });

  it("retorna 401 quando o secret não bate", async () => {
    const res = await POST(makeRequest("wrong", {}));
    expect(res.status).toBe(401);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o secret está ausente", async () => {
    const res = await POST(makeRequest(null, {}));
    expect(res.status).toBe(401);
  });

  it("ACK 2 (delivered) atualiza o status pra DELIVERED", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "DELIVERY_ACK" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("wamid.abc", "DELIVERED");
  });

  it("ACK 3 (read) atualiza o status pra READ", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "READ" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("wamid.abc", "READ");
  });

  it("ACK 1 (sent) é ignorado silenciosamente — já setamos SENT no momento do envio", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "SERVER_ACK" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("corpo malformado (sem data.keyId) retorna 200 sem chamar o update", async () => {
    const res = await POST(makeRequest("shh", { event: "messages.update" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });
});
