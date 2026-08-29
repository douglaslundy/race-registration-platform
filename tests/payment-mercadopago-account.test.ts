import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const create = vi.fn().mockResolvedValue({ id: 999, status: "approved", fee_details: [] });
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation((opts) => ({ __opts: opts })),
  Payment: vi.fn().mockImplementation(() => ({ create, get: vi.fn(), cancel: vi.fn() })),
  PaymentRefund: vi.fn().mockImplementation(() => ({ create: vi.fn().mockResolvedValue({ id: 1 }) })),
}));
vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("GLOBAL_TOKEN"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue("GLOBAL_SECRET"),
}));

import { MercadoPagoConfig } from "mercadopago";
import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

beforeEach(() => vi.clearAllMocks());

const ACC = { id: "acc_1", accessToken: "ACC_TOKEN", webhookSecret: "ACC_SECRET", publicKey: null, label: "x", archived: false };

describe("MercadoPagoProvider — conta no construtor", () => {
  it("com conta: usa o accessToken da conta", async () => {
    const p = new MercadoPagoProvider(ACC);
    await p.createPayment({ orderId: "o1", amount: 1000, method: "PIX", idempotencyKey: "k", buyer: { name: "A B", email: "a@b.c" }, description: "d" });
    expect(vi.mocked(MercadoPagoConfig)).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "ACC_TOKEN" }));
  });

  it("sem conta: cai no token global (retrocompat Pagar.me/legado)", async () => {
    const p = new MercadoPagoProvider();
    await p.createPayment({ orderId: "o1", amount: 1000, method: "PIX", idempotencyKey: "k", buyer: { name: "A B", email: "a@b.c" }, description: "d" });
    expect(vi.mocked(MercadoPagoConfig)).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "GLOBAL_TOKEN" }));
  });

  it("verifyWebhookSignature valida com o secret da conta e rejeita a mesma assinatura sem conta (secret global)", async () => {
    const ts = "1700000000";
    const payload = '{"data":{"id":"123"}}';
    const manifest = `id:123;request-id:${ts};ts:${ts}`;
    const v1 = crypto.createHmac("sha256", "ACC_SECRET").update(manifest).digest("hex");
    const sig = `ts=${ts},v1=${v1}`;

    // com a conta ("ACC_SECRET") → assinatura confere
    expect(await new MercadoPagoProvider(ACC).verifyWebhookSignature(payload, sig)).toBe(true);

    // sem conta → usa o secret global ("GLOBAL_SECRET"), mesma assinatura não confere
    expect(await new MercadoPagoProvider().verifyWebhookSignature(payload, sig)).toBe(false);
  });

  it("branch de cartão: o lookup de card_tokens usa o token da conta (Bearer ACC_TOKEN)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payment_method_id: "visa" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    create.mockResolvedValueOnce({ id: 1, status: "approved" });

    const p = new MercadoPagoProvider(ACC);
    await p.createPayment({
      orderId: "o1",
      amount: 5000,
      method: "CREDIT_CARD",
      idempotencyKey: "k",
      buyer: { name: "A B", email: "a@b.c" },
      description: "d",
      cardToken: "tok_x",
      installments: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/card_tokens/tok_x",
      expect.objectContaining({ headers: { Authorization: "Bearer ACC_TOKEN" } }),
    );
    vi.unstubAllGlobals();
  });
});
