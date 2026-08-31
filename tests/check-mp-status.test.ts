import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMPPaymentStatus } from "@/lib/payment/check-mp-status";

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("global-token"),
}));

describe("checkMPPaymentStatus — binding de pedido/valor (M5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const params = { expectedOrderId: "order-1", expectedAmount: 10000, accessToken: "tok" };

  it("retorna PAID quando aprovado E external_reference e valor batem", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved", external_reference: "order-1", transaction_amount: 100 }),
    });
    expect(await checkMPPaymentStatus("mp-1", params)).toBe("PAID");
  });

  it("NÃO retorna PAID quando o external_reference é de outro pedido", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved", external_reference: "order-OUTRO", transaction_amount: 100 }),
    });
    expect(await checkMPPaymentStatus("mp-1", params)).toBeNull();
  });

  it("NÃO retorna PAID quando o valor não bate", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved", external_reference: "order-1", transaction_amount: 1 }),
    });
    expect(await checkMPPaymentStatus("mp-1", params)).toBeNull();
  });

  it("retorna CANCELLED para status cancelado/rejeitado/expirado", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "rejected" }),
    });
    expect(await checkMPPaymentStatus("mp-1", params)).toBe("CANCELLED");
  });

  it("retorna null quando a API do MP responde erro", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false });
    expect(await checkMPPaymentStatus("mp-1", params)).toBeNull();
  });
});
