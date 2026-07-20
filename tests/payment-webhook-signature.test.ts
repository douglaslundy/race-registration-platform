import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const { mockGetMPSecret, mockGetPagarMePassword } = vi.hoisted(() => ({
  mockGetMPSecret: vi.fn(),
  mockGetPagarMePassword: vi.fn(),
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({})),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn(),
  getMercadoPagoWebhookSecret: mockGetMPSecret,
  getPagarMeApiKey: vi.fn(),
  getPagarMeWebhookPassword: mockGetPagarMePassword,
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";
import { PagarMeProvider } from "@/lib/payment/pagarme";

describe("MercadoPagoProvider.verifyWebhookSignature", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita (falha fechada) quando o segredo do webhook não está configurado, mesmo com uma assinatura presente", async () => {
    mockGetMPSecret.mockResolvedValueOnce(null);
    const provider = new MercadoPagoProvider();
    const result = await provider.verifyWebhookSignature('{"data":{"id":"123"}}', "ts=1700000000,v1=qualquercoisa");
    expect(result).toBe(false);
  });

  it("rejeita quando o segredo é uma string vazia", async () => {
    mockGetMPSecret.mockResolvedValueOnce("");
    const provider = new MercadoPagoProvider();
    const result = await provider.verifyWebhookSignature('{"data":{"id":"123"}}', "ts=1700000000,v1=qualquercoisa");
    expect(result).toBe(false);
  });

  it("aceita quando o HMAC da assinatura bate com o segredo configurado", async () => {
    const secret = "super-secreto";
    mockGetMPSecret.mockResolvedValueOnce(secret);
    const payload = JSON.stringify({ data: { id: "123" } });
    const ts = "1700000000";
    const manifest = `id:123;request-id:${ts};ts:${ts}`;
    const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

    const provider = new MercadoPagoProvider();
    const result = await provider.verifyWebhookSignature(payload, `ts=${ts},v1=${v1}`);
    expect(result).toBe(true);
  });

  it("rejeita quando o HMAC não bate com o segredo configurado", async () => {
    mockGetMPSecret.mockResolvedValueOnce("super-secreto");
    const wrongButSameLength = crypto.createHmac("sha256", "outro-segredo").update("outro-payload").digest("hex");
    const provider = new MercadoPagoProvider();
    const result = await provider.verifyWebhookSignature('{"data":{"id":"123"}}', `ts=1700000000,v1=${wrongButSameLength}`);
    expect(result).toBe(false);
  });
});

describe("PagarMeProvider.verifyWebhookSignature", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita (falha fechada) quando a senha do webhook não está configurada, mesmo com um header presente", async () => {
    mockGetPagarMePassword.mockResolvedValueOnce(null);
    const provider = new PagarMeProvider();
    const result = await provider.verifyWebhookSignature("{}", "Basic cXVhbHF1ZXJjb2lzYTo=");
    expect(result).toBe(false);
  });

  it("rejeita quando a senha é uma string vazia", async () => {
    mockGetPagarMePassword.mockResolvedValueOnce("");
    const provider = new PagarMeProvider();
    const result = await provider.verifyWebhookSignature("{}", "Basic cXVhbHF1ZXJjb2lzYTo=");
    expect(result).toBe(false);
  });

  it("aceita quando o header Authorization Basic corresponde à senha configurada", async () => {
    const password = "senha-webhook";
    mockGetPagarMePassword.mockResolvedValueOnce(password);
    const expected = `Basic ${Buffer.from(`${password}:`).toString("base64")}`;

    const provider = new PagarMeProvider();
    const result = await provider.verifyWebhookSignature("{}", expected);
    expect(result).toBe(true);
  });

  it("aceita quando a assinatura HMAC (X-Hub-Signature) bate com a senha configurada", async () => {
    const password = "senha-webhook";
    mockGetPagarMePassword.mockResolvedValueOnce(password);
    const payload = '{"type":"charge.paid"}';
    const hmac = crypto.createHmac("sha256", password).update(payload).digest("hex");

    const provider = new PagarMeProvider();
    const result = await provider.verifyWebhookSignature(payload, `sha256=${hmac}`);
    expect(result).toBe(true);
  });

  it("rejeita quando o header Authorization não corresponde à senha configurada", async () => {
    mockGetPagarMePassword.mockResolvedValueOnce("senha-webhook");
    const provider = new PagarMeProvider();
    const result = await provider.verifyWebhookSignature("{}", "Basic ZXJyYWRvOg==");
    expect(result).toBe(false);
  });
});
