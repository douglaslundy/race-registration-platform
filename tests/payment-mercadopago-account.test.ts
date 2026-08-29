import { describe, it, expect, vi, beforeEach } from "vitest";

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

it("verifyWebhookSignature usa o secret da conta", async () => {
  const p = new MercadoPagoProvider(ACC);
  // secret errado → não valida (não lança, retorna false)
  const ok = await p.verifyWebhookSignature('{"data":{"id":"1"}}', "ts=1,v1=deadbeef");
  expect(ok).toBe(false);
});
