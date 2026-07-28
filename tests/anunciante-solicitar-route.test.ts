import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/advertisers/request-advertiser", () => ({ requestAdvertiserAccount: vi.fn() }));
vi.mock("@/lib/checkout-ads", () => ({ createAdPlanCheckout: vi.fn() }));
vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getPaymentProviderSetting: vi.fn() }));

import { POST } from "@/app/api/anunciante/solicitar/route";
import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting } from "@/lib/payment-settings";

const authMock = vi.mocked(auth);
const dbMock = db as any;

const PROFILE = {
  companyName: "Empresa X",
  document: "111.444.777-35",
  address: "Rua Teste, 123",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/anunciante/solicitar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/anunciante/solicitar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(null as any);
  });

  it("retorna 400 quando visitante anônimo não envia dados de conta nova", async () => {
    const res = await POST(makeRequest({ profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(400);
    expect(requestAdvertiserAccount).not.toHaveBeenCalled();
  });

  it("retorna erro da conta/perfil quando requestAdvertiserAccount falha", async () => {
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: false, error: "E-mail já cadastrado", status: 409 });

    const res = await POST(makeRequest({
      newAccount: { name: "Fulano", email: "ja@existe.com", password: "senha1234" },
      profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX",
    }));

    expect(res.status).toBe(409);
    expect(createAdPlanCheckout).not.toHaveBeenCalled();
  });

  it("cria conta+perfil+compra e chama o gateway com sucesso (visitante anônimo)", async () => {
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: true, userId: "user-1", advertiserId: "adv-1" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-1", totalAmount: 9900 });
    const createPayment = vi.fn().mockResolvedValueOnce({ providerPaymentId: "pp-1", status: "PENDING", pixQrCodeText: "00020101..." });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValueOnce("MERCADO_PAGO" as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(makeRequest({
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX",
    }));

    expect(createAdPlanCheckout).toHaveBeenCalledWith("adv-1", "plan-1");
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ orderId: "purchase-1", amount: 9900, method: "PIX" }));
    expect(dbMock.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ adPurchaseId: "purchase-1" }) });
    expect(res.status).toBe(200);
  });

  it("reaproveita a sessão já logada, ignora newAccount se enviado por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-logado", name: "Fulano", email: "fulano@example.com", role: "ATHLETE" } } as any);
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: true, userId: "user-logado", advertiserId: "adv-2" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-2", totalAmount: 4900 });
    const createPayment = vi.fn().mockResolvedValueOnce({ providerPaymentId: "pp-2", status: "PENDING" });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValueOnce("MERCADO_PAGO" as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-2" });

    const res = await POST(makeRequest({ profile: PROFILE, adPlanId: "plan-2", paymentMethod: "PIX" }));

    expect(requestAdvertiserAccount).toHaveBeenCalledWith(
      expect.objectContaining({ existingUserId: "user-logado", newAccount: null }),
    );
    expect(res.status).toBe(200);
  });
});
