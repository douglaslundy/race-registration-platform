import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/checkout-ads", () => ({ createAdPlanCheckout: vi.fn() }));
vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));

import { POST } from "@/app/api/checkout-ads/route";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/checkout-ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout-ads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(403);
  });

  it("cria a compra, chama o gateway e grava o Payment com adPurchaseId", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ADVERTISER", name: "Fulano", email: "f@example.com" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "adv-1" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-1", totalAmount: 9900 });
    const createPayment = vi.fn().mockResolvedValueOnce({
      providerPaymentId: "pp-1",
      status: "PENDING",
      pixQrCodeText: "00020101...",
    });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));

    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "purchase-1",
      amount: 9900,
      method: "PIX",
    }));
    expect(dbMock.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ adPurchaseId: "purchase-1", amount: 9900 }),
    });
    expect(res.status).toBe(200);
  });
});
