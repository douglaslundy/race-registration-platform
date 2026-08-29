import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/payment/sync-payment-status", () => ({ applyGatewayStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));
vi.mock("@/lib/ads/ad-purchase-confirmation", () => ({ confirmAdPurchasePayment: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdPurchaseConfirmationEmail: vi.fn() }));
vi.mock("@/lib/alerts/advertiser-request-pending", () => ({ notifyAdvertiserRequestPending: vi.fn() }));

import { processPaymentWebhookEvent } from "@/lib/payment/webhook-handler";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";

const dbMock = db as any;

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    providerPaymentId: "pay-1",
    status: "PAID" as const,
    rawPayload: {},
    ...overrides,
  };
}

function orderPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    status: "PENDING",
    orderId: "order-1",
    adPurchaseId: null,
    paymentAccountId: null,
    order: {
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
      buyer: { name: "Atleta", email: "atleta@example.com" },
    },
    adPurchase: null,
    ...overrides,
  };
}

describe("processPaymentWebhookEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
    vi.mocked(applyGatewayStatus).mockResolvedValue({ changed: true } as any);
  });

  it("retorna { handled: false } quando o payment não é encontrado", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(null);

    const res = await processPaymentWebhookEvent(baseEvent());

    expect(res).toEqual({ handled: false });
    expect(applyGatewayStatus).not.toHaveBeenCalled();
  });

  it("retorna { handled: false } e NÃO chama applyGatewayStatus quando accountId não bate com payment.paymentAccountId", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment({ paymentAccountId: "acc-A" }));

    const res = await processPaymentWebhookEvent(baseEvent({ accountId: "acc-B" }));

    expect(res).toEqual({ handled: false });
    expect(applyGatewayStatus).not.toHaveBeenCalled();
  });

  it("chama applyGatewayStatus quando accountId bate com payment.paymentAccountId", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment({ paymentAccountId: "acc-A" }));

    const res = await processPaymentWebhookEvent(baseEvent({ accountId: "acc-A" }));

    expect(res).toEqual({ handled: true });
    expect(applyGatewayStatus).toHaveBeenCalled();
  });

  it("aplica normalmente quando não há accountId no evento (endpoint legado)", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment({ paymentAccountId: "acc-A" }));

    const res = await processPaymentWebhookEvent(baseEvent());

    expect(res).toEqual({ handled: true });
    expect(applyGatewayStatus).toHaveBeenCalled();
  });

  it("dispara notifyOrderConfirmed quando o status é PAID", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment());

    await processPaymentWebhookEvent(baseEvent({ status: "PAID" }));

    expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1");
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("dispara notifyPaymentError quando o status é CANCELLED", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment());

    await processPaymentWebhookEvent(baseEvent({ status: "CANCELLED" }));

    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it("dispara notifyPaymentError quando o status é EXPIRED", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment());

    await processPaymentWebhookEvent(baseEvent({ status: "EXPIRED" }));

    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não dispara notificações quando applyGatewayStatus não mudou nada", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(orderPayment());
    vi.mocked(applyGatewayStatus).mockResolvedValueOnce({ changed: false } as any);

    const res = await processPaymentWebhookEvent(baseEvent({ status: "PAID" }));

    expect(res).toEqual({ handled: true });
    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it("segue o caminho de AdPurchase (confirmAdPurchasePayment) e não chama applyGatewayStatus quando adPurchaseId está presente", async () => {
    const payment = {
      id: "payment-ads-1",
      status: "PENDING",
      orderId: null,
      adPurchaseId: "adpurchase-1",
      paymentAccountId: null,
      order: null,
      adPurchase: {
        id: "adpurchase-1",
        status: "PENDING",
        advertiser: { user: { name: "Anunciante", email: "anunciante@example.com" } },
        adPlan: { name: "Plano Ouro", durationDays: 30 },
      },
    };
    dbMock.payment.findFirst.mockResolvedValueOnce(payment);
    vi.mocked(confirmAdPurchasePayment).mockResolvedValueOnce({ changed: false } as any);

    const res = await processPaymentWebhookEvent(baseEvent({ providerPaymentId: "pay-ads-1", status: "PAID" }));

    expect(res).toEqual({ handled: true });
    expect(confirmAdPurchasePayment).toHaveBeenCalledWith(expect.anything(), payment, "PAID");
    expect(applyGatewayStatus).not.toHaveBeenCalled();
  });

  it("retorna { handled: false } quando o payment não tem order nem adPurchase", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-orphan",
      status: "PENDING",
      orderId: null,
      adPurchaseId: null,
      paymentAccountId: null,
      order: null,
      adPurchase: null,
    });

    const res = await processPaymentWebhookEvent(baseEvent({ status: "PAID" }));

    expect(res).toEqual({ handled: false });
    expect(applyGatewayStatus).not.toHaveBeenCalled();
  });
});
