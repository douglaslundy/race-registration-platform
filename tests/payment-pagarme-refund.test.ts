import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";

describe("PagarMeProvider.refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("sends a DELETE request to /charges/{id} and returns the refund id", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "ch_refund_1" }),
    });

    const provider = new PagarMeProvider();
    const result = await provider.refundPayment({ providerPaymentId: "ch_123" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pagar.me/core/v5/charges/ch_123",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ providerRefundId: "ch_refund_1" });
  });

  it("throws when the gateway returns an error status", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "charge already refunded",
    });

    const provider = new PagarMeProvider();
    await expect(provider.refundPayment({ providerPaymentId: "ch_123" })).rejects.toThrow("Pagar.me 422");
  });
});
