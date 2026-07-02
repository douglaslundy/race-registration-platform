import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn(),
  PaymentRefund: vi.fn().mockImplementation(() => ({ create: createMock })),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

describe("MercadoPagoProvider.refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls PaymentRefund.create with the provider payment id and returns the refund id", async () => {
    createMock.mockResolvedValueOnce({ id: 999 });
    const provider = new MercadoPagoProvider();
    const result = await provider.refundPayment({ providerPaymentId: "123456" });
    expect(createMock).toHaveBeenCalledWith({ payment_id: "123456" });
    expect(result).toEqual({ providerRefundId: "999" });
  });

  it("propagates an error when the gateway call fails", async () => {
    createMock.mockRejectedValueOnce(new Error("MP down"));
    const provider = new MercadoPagoProvider();
    await expect(provider.refundPayment({ providerPaymentId: "123456" })).rejects.toThrow("MP down");
  });
});
