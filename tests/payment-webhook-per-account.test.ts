import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/account-resolver", () => {
  class NoPaymentAccountError extends Error {
    constructor(msg = "Nenhuma conta Mercado Pago configurada") {
      super(msg);
      this.name = "NoPaymentAccountError";
    }
  }
  return {
    getPaymentAccountById: vi.fn(),
    getDefaultPaymentAccount: vi.fn(),
    resolveEventPaymentAccount: vi.fn(),
    NoPaymentAccountError,
  };
});

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment/webhook-handler", () => ({ processPaymentWebhookEvent: vi.fn() }));
vi.mock("@/lib/payment/mercadopago", () => ({ extractGatewayFeeAmount: vi.fn().mockReturnValue(2.5) }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/webhooks/payment/mp/[accountId]/route";
import { POST as LEGACY_POST } from "@/app/api/webhooks/payment/route";
import {
  getPaymentAccountById,
  getDefaultPaymentAccount,
  NoPaymentAccountError,
} from "@/lib/payment/account-resolver";
import { getPaymentProvider } from "@/lib/payment";
import { processPaymentWebhookEvent } from "@/lib/payment/webhook-handler";

const ACCOUNT = { id: "acc_1", accessToken: "TOKEN_1", webhookSecret: "S", publicKey: null, label: "Conta 1", archived: false };

function req(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/payment/mp/acc_1", {
    method: "POST",
    body,
    headers,
  }) as unknown as import("next/server").NextRequest;
}

const params = Promise.resolve({ accountId: "acc_1" });

function provider(verify = true) {
  return {
    verifyWebhookSignature: vi.fn().mockResolvedValue(verify),
    parseWebhookPayload: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processPaymentWebhookEvent).mockResolvedValue({ handled: true });
  global.fetch = vi.fn();
});

describe("webhook por conta — /api/webhooks/payment/mp/[accountId]", () => {
  it("accountId inexistente → 404", async () => {
    vi.mocked(getPaymentAccountById).mockRejectedValueOnce(new NoPaymentAccountError());
    const res = await POST(req(JSON.stringify({ action: "payment.updated", data: { id: "1" } })), { params });
    expect(res.status).toBe(404);
    expect(processPaymentWebhookEvent).not.toHaveBeenCalled();
  });

  it("assinatura inválida → 401 e o handler não é chamado", async () => {
    vi.mocked(getPaymentAccountById).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce(provider(false) as any);
    const res = await POST(req(JSON.stringify({ action: "payment.updated", data: { id: "1" } }), { "x-signature": "ruim" }), { params });
    expect(res.status).toBe(401);
    expect(processPaymentWebhookEvent).not.toHaveBeenCalled();
  });

  it("assinatura válida + payment.updated → handler com accountId = params e status re-consultado na API", async () => {
    vi.mocked(getPaymentAccountById).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce(provider(true) as any);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved", date_approved: "2026-08-29T10:00:00.000Z" }),
    } as any);

    const res = await POST(
      req(JSON.stringify({ action: "payment.updated", data: { id: "999" } }), { "x-signature": "ok" }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/999",
      { headers: { Authorization: "Bearer TOKEN_1" } },
    );
    expect(processPaymentWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: "999",
        status: "PAID",
        paidAt: "2026-08-29T10:00:00.000Z",
        accountId: "acc_1",
      }),
    );
  });

  it("processPaymentWebhookEvent retornando { handled: false } → ainda 200 { ok: true }", async () => {
    vi.mocked(getPaymentAccountById).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce(provider(true) as any);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "cancelled" }),
    } as any);
    vi.mocked(processPaymentWebhookEvent).mockResolvedValueOnce({ handled: false });

    const res = await POST(
      req(JSON.stringify({ action: "payment.updated", data: { id: "42" } }), { "x-signature": "ok" }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("processPaymentWebhookEvent rejeitando (erro transitório) → ainda 200 { ok: true }", async () => {
    vi.mocked(getPaymentAccountById).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce(provider(true) as any);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved" }),
    } as any);
    vi.mocked(processPaymentWebhookEvent).mockRejectedValueOnce(new Error("db offline"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      req(JSON.stringify({ action: "payment.updated", data: { id: "77" } }), { "x-signature": "ok" }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("corpo não parseável → 400", async () => {
    vi.mocked(getPaymentAccountById).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce(provider(true) as any);
    const res = await POST(req("isto não é json", { "x-signature": "ok" }), { params });
    expect(res.status).toBe(400);
    expect(processPaymentWebhookEvent).not.toHaveBeenCalled();
  });
});

describe("shim legado — /api/webhooks/payment (branch MP)", () => {
  it("resolve a conta padrão e chama o handler com accountId: undefined", async () => {
    vi.mocked(getDefaultPaymentAccount).mockResolvedValueOnce(ACCOUNT as any);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      verifyWebhookSignature: vi.fn().mockResolvedValue(true),
      parseWebhookPayload: vi.fn().mockReturnValue({
        providerPaymentId: "pay-legacy",
        status: "CANCELLED",
        rawPayload: {},
      }),
    } as any);

    const res = await LEGACY_POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ action: "outro", data: { id: "pay-legacy" } }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(getDefaultPaymentAccount).toHaveBeenCalled();
    expect(processPaymentWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ providerPaymentId: "pay-legacy", accountId: undefined }),
    );
  });

  it("sem conta padrão cadastrada (NoPaymentAccountError) → segue o caminho antigo sem estourar", async () => {
    vi.mocked(getDefaultPaymentAccount).mockRejectedValueOnce(new NoPaymentAccountError());
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      verifyWebhookSignature: vi.fn().mockResolvedValue(true),
      parseWebhookPayload: vi.fn().mockReturnValue({
        providerPaymentId: "pay-legacy-2",
        status: "CANCELLED",
        rawPayload: {},
      }),
    } as any);

    const res = await LEGACY_POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ action: "outro", data: { id: "pay-legacy-2" } }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(processPaymentWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ providerPaymentId: "pay-legacy-2", accountId: undefined }),
    );
  });
});
