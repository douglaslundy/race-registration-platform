import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({ create: createMock })),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";
import type { CreatePaymentInput } from "@/lib/payment/types";

const baseInput: CreatePaymentInput = {
  orderId: "order-1",
  amount: 10000,
  method: "CREDIT_CARD",
  idempotencyKey: "idem-1",
  buyer: { name: "Ana Silva", email: "ana@example.com" },
  description: "Inscrição #1",
  cardToken: "card-token-1",
  cardBrand: "visa",
  installments: 1,
};

describe("MercadoPagoProvider.createPayment (cartão)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia 'approved' para PAID e extrai a comissão do gateway", async () => {
    createMock.mockResolvedValueOnce({
      id: 123,
      status: "approved",
      fee_details: [{ type: "mercadopago_fee", amount: 4.99, fee_payer: "collector" }],
    });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PAID");
    expect(result.gatewayFeeAmount).toBe(499);
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'rejected' para CANCELLED, sem expiresAt", async () => {
    createMock.mockResolvedValueOnce({ id: 124, status: "rejected" });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("CANCELLED");
    expect(result.expiresAt).toBeUndefined();
  });

  it("mapeia 'in_process' para PENDING com expiresAt ~48h no futuro", async () => {
    createMock.mockResolvedValueOnce({ id: 125, status: "in_process" });
    const before = Date.now();
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
    const deltaMs = (result.expiresAt as Date).getTime() - before;
    expect(deltaMs).toBeGreaterThan(47 * 3600 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(48 * 3600 * 1000 + 5000);
  });

  it("mapeia qualquer outro status pendente (ex.: 'pending') da mesma forma", async () => {
    createMock.mockResolvedValueOnce({ id: 126, status: "pending" });
    const provider = new MercadoPagoProvider();
    const result = await provider.createPayment(baseInput);
    expect(result.status).toBe("PENDING");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});
