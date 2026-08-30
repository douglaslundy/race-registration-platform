import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/payment-settings", () => ({
  getPaymentProviderSetting: vi.fn(),
  getMercadoPagoPublicKey: vi.fn(),
  getPagarMePublicKey: vi.fn(),
}));

vi.mock("@/lib/payment/account-resolver", () => ({
  resolveEventPaymentAccount: vi.fn(),
}));

import { GET } from "@/app/api/checkout/card-config/route";
import { auth } from "@/lib/auth";
import {
  getPaymentProviderSetting,
  getMercadoPagoPublicKey,
  getPagarMePublicKey,
} from "@/lib/payment-settings";
import { resolveEventPaymentAccount } from "@/lib/payment/account-resolver";

const authMock = vi.mocked(auth);

function req(url: string) {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } } as any);
  vi.mocked(getPaymentProviderSetting).mockResolvedValue("mercadopago");
  vi.mocked(getMercadoPagoPublicKey).mockResolvedValue("MP-GLOBAL-PUB");
  vi.mocked(getPagarMePublicKey).mockResolvedValue("PAGARME-PUB");
});

describe("checkout/card-config", () => {
  it("401 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await GET(req("http://localhost/api/checkout/card-config"));
    expect(res.status).toBe(401);
  });

  it("?eventId + provider mercadopago → publicKey da conta resolvida", async () => {
    vi.mocked(resolveEventPaymentAccount).mockResolvedValueOnce({
      id: "acc-1",
      accessToken: "t",
      webhookSecret: "s",
      publicKey: "ACCOUNT-PUB",
      label: "Conta 1",
      archived: false,
    });

    const res = await GET(req("http://localhost/api/checkout/card-config?eventId=ev-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "mercadopago", publicKey: "ACCOUNT-PUB" });
    expect(resolveEventPaymentAccount).toHaveBeenCalledWith("ev-1");
  });

  it("resolveEventPaymentAccount lança → publicKey: null e 200 (não 500)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resolveEventPaymentAccount).mockRejectedValueOnce(new Error("sem conta"));

    const res = await GET(req("http://localhost/api/checkout/card-config?eventId=ev-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "mercadopago", publicKey: null });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("sem ?eventId → cai no getMercadoPagoPublicKey() global", async () => {
    const res = await GET(req("http://localhost/api/checkout/card-config"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "mercadopago", publicKey: "MP-GLOBAL-PUB" });
    expect(resolveEventPaymentAccount).not.toHaveBeenCalled();
    expect(getMercadoPagoPublicKey).toHaveBeenCalled();
  });
});
