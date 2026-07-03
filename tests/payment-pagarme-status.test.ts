import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";

describe("PagarMeProvider.checkPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("faz GET em /charges/{id} e mapeia 'paid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "paid" }) });
    const provider = new PagarMeProvider();
    const result = await provider.checkPaymentStatus("ch_123");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pagar.me/core/v5/charges/ch_123",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toBe("PAID");
  });

  it("mapeia 'overpaid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "overpaid" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("PAID");
  });

  it("mapeia 'refunded' para REFUNDED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "refunded" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("REFUNDED");
  });

  it("mapeia 'chargedback' para CHARGEBACK", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "chargedback" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("CHARGEBACK");
  });

  it("mapeia 'failed' para CANCELLED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "failed" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("CANCELLED");
  });

  it("mapeia qualquer outro status (ex.: 'pending') para PENDING", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "pending" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("PENDING");
  });

  it("lança erro quando a chamada falha", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" });
    const provider = new PagarMeProvider();
    await expect(provider.checkPaymentStatus("ch_123")).rejects.toThrow("Pagar.me 404");
  });
});
