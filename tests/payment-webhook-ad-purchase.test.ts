import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));
vi.mock("@/lib/payment/sync-payment-status", () => ({ applyGatewayStatus: vi.fn() }));
vi.mock("@/lib/ads/ad-purchase-confirmation", () => ({ confirmAdPurchasePayment: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdPurchaseConfirmationEmail: vi.fn() }));

import { POST } from "@/app/api/webhooks/payment/route";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";
import { sendAdPurchaseConfirmationEmail } from "@/lib/email";

const dbMock = db as any;

function makeProvider(parsed: unknown) {
  return {
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    parseWebhookPayload: vi.fn().mockReturnValue(parsed),
  };
}

describe("payment webhook — branch de AdPurchase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("chama confirmAdPurchasePayment (via transação) e NÃO chama applyGatewayStatus quando o payment é de AdPurchase", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-ads-1", status: "PAID", rawPayload: {} }) as any,
    );
    const payment = {
      id: "payment-ads-1",
      status: "PENDING",
      orderId: null,
      adPurchaseId: "adpurchase-1",
      order: null,
      adPurchase: {
        id: "adpurchase-1",
        status: "PENDING",
        advertiser: { user: { name: "Anunciante", email: "anunciante@example.com" } },
        adPlan: { name: "Plano Ouro", durationDays: 30 },
      },
    };
    dbMock.payment.findFirst.mockResolvedValueOnce(payment);
    vi.mocked(confirmAdPurchasePayment).mockResolvedValueOnce({ changed: false });

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(confirmAdPurchasePayment).toHaveBeenCalledWith(expect.anything(), payment, "PAID");
    expect(applyGatewayStatus).not.toHaveBeenCalled();
    expect(sendAdPurchaseConfirmationEmail).not.toHaveBeenCalled();
  });
});
