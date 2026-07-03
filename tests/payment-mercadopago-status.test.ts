import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({ get: getMock })),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

describe("MercadoPagoProvider.checkPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia 'approved' para PAID", async () => {
    getMock.mockResolvedValueOnce({ status: "approved" });
    const provider = new MercadoPagoProvider();
    const result = await provider.checkPaymentStatus("123456");
    expect(getMock).toHaveBeenCalledWith({ id: "123456" });
    expect(result).toBe("PAID");
  });

  it("mapeia 'cancelled' para CANCELLED", async () => {
    getMock.mockResolvedValueOnce({ status: "cancelled" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CANCELLED");
  });

  it("mapeia 'rejected' para CANCELLED", async () => {
    getMock.mockResolvedValueOnce({ status: "rejected" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CANCELLED");
  });

  it("mapeia 'refunded' para REFUNDED", async () => {
    getMock.mockResolvedValueOnce({ status: "refunded" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("REFUNDED");
  });

  it("mapeia 'charged_back' para CHARGEBACK", async () => {
    getMock.mockResolvedValueOnce({ status: "charged_back" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CHARGEBACK");
  });

  it("mapeia 'expired' para EXPIRED", async () => {
    getMock.mockResolvedValueOnce({ status: "expired" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("EXPIRED");
  });

  it("mapeia qualquer outro status (ex.: 'in_process') para PENDING", async () => {
    getMock.mockResolvedValueOnce({ status: "in_process" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("PENDING");
  });
});
