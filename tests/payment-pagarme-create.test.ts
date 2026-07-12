import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";
import type { CreatePaymentInput } from "@/lib/payment/types";

const baseInput: CreatePaymentInput = {
  orderId: "order-1",
  amount: 10000,
  method: "CREDIT_CARD",
  idempotencyKey: "idem-1",
  buyer: { name: "Ana Silva", email: "ana@example.com" },
  description: "Inscrição #1",
  cardToken: "card-token-1",
  installments: 1,
};

describe("PagarMeProvider.createPayment (cartão)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("mapeia 'paid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_1", status: "paid" }) });
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PAID");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'failed' para CANCELLED, sem expiresAt", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_2", status: "failed" }) });
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("CANCELLED");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'canceled' para CANCELLED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_3", status: "canceled" }) });
    const provider = new PagarMeProvider();
    expect((await provider.createPayment(baseInput)).status).toBe("CANCELLED");
  });

  it("mapeia 'processing' para PENDING com expiresAt ~1h no futuro", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "ch_4", status: "processing" }) });
    const before = Date.now();
    const provider = new PagarMeProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
    const deltaMs = (result.expiresAt as Date).getTime() - before;
    expect(deltaMs).toBeGreaterThan(59 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(3600 * 1000 + 5000);
  });
});
