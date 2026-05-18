import { describe, it, expect } from "vitest";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

describe("SandboxPaymentProvider", () => {
  const provider = new SandboxPaymentProvider();

  it("creates PIX payment with PENDING status", async () => {
    const result = await provider.createPayment({
      orderId: "order_1",
      amount: 15000,
      method: "PIX",
      idempotencyKey: "test_pix_1",
      buyer: { name: "Test User", email: "test@test.com" },
      description: "Inscrição #1",
    });

    expect(result.status).toBe("PENDING");
    expect(result.providerPaymentId).toContain("sandbox_test_pix_1");
    expect(result.pixQrCodeText).toBeDefined();
    expect(result.expiresAt).toBeDefined();
  });

  it("creates credit card payment with PAID status", async () => {
    const result = await provider.createPayment({
      orderId: "order_2",
      amount: 15000,
      method: "CREDIT_CARD",
      idempotencyKey: "test_cc_1",
      buyer: { name: "Test User", email: "test@test.com" },
      description: "Inscrição #2",
    });

    expect(result.status).toBe("PAID");
  });

  it("verifies webhook signature", () => {
    expect(provider.verifyWebhookSignature("payload", "sandbox-secret")).toBe(true);
    expect(provider.verifyWebhookSignature("payload", "wrong-secret")).toBe(false);
  });

  it("parses webhook payload", () => {
    const parsed = provider.parseWebhookPayload({
      id: "sandbox_123",
      status: "PAID",
      paid_at: "2025-01-01T00:00:00Z",
    });

    expect(parsed.providerPaymentId).toBe("sandbox_123");
    expect(parsed.status).toBe("PAID");
    expect(parsed.paidAt).toBe("2025-01-01T00:00:00Z");
  });
});
