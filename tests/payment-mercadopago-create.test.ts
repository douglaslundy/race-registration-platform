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

  it("3028 (payment_method_id inválido) cai para a chamada sem payment_method_id", async () => {
    const err3028 = { message: "Invalid payment_method_id", status: 400, cause: [{ code: 3028 }] };
    createMock.mockRejectedValueOnce(err3028).mockResolvedValueOnce({ id: 200, status: "approved" });
    const result = await new MercadoPagoProvider().createPayment(baseInput);
    expect(result.status).toBe("PAID");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1][0].body).not.toHaveProperty("payment_method_id");
    expect(createMock.mock.calls[1][0].requestOptions.idempotencyKey).toBe("idem-1-m1");
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

  it("recusa devolve o status_detail e o pagamento leva additional_info para o antifraude", async () => {
    createMock.mockResolvedValueOnce({ id: 300, status: "rejected", status_detail: "cc_rejected_high_risk" });
    const result = await new MercadoPagoProvider().createPayment({
      ...baseInput,
      buyer: {
        ...baseInput.buyer,
        phone: "+55 (35) 99999-1234",
        registeredAt: new Date("2026-01-02T03:04:05.000Z"),
        address: { zipCode: "37900-000", street: "Rua A", number: "10" },
      },
    });
    expect(result).toMatchObject({ status: "CANCELLED", statusDetail: "cc_rejected_high_risk" });
    const info = createMock.mock.calls[0][0].body.additional_info;
    expect(info.items[0]).toMatchObject({ id: "order-1", category_id: "tickets", quantity: 1, unit_price: 100 });
    expect(info.payer).toEqual({
      first_name: "Ana",
      last_name: "Silva",
      phone: { area_code: "35", number: "999991234" },
      address: { zip_code: "37900000", street_name: "Rua A", street_number: "10" },
      registration_date: "2026-01-02T03:04:05.000Z",
    });
  });

  it("additional_info omite telefone/endereço ausentes ou inválidos", async () => {
    createMock.mockResolvedValueOnce({ id: 301, status: "approved" });
    await new MercadoPagoProvider().createPayment({ ...baseInput, buyer: { ...baseInput.buyer, phone: "123" } });
    expect(createMock.mock.calls[0][0].body.additional_info.payer).toEqual({ first_name: "Ana", last_name: "Silva" });
  });

  it("10105 (Bin not found) tenta sem payment_method_id e, se persistir, devolve erro exibível", async () => {
    const err10105 = { message: "bin_not_found", status: 400, cause: [{ code: 10105, description: "Bin not found" }] };
    createMock.mockRejectedValueOnce(err10105).mockResolvedValueOnce({ id: 400, status: "approved" });
    expect((await new MercadoPagoProvider().createPayment(baseInput)).status).toBe("PAID");
    expect(createMock.mock.calls[1][0].body).not.toHaveProperty("payment_method_id");

    createMock.mockRejectedValue(err10105);
    await expect(new MercadoPagoProvider().createPayment(baseInput)).rejects.toThrow(/não reconheceu este cartão/);
    createMock.mockReset();
  });
});
