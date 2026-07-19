import { describe, expect, it, vi } from "vitest";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";

function makeTx() {
  return {
    payment: { update: vi.fn() },
    adPurchase: { update: vi.fn() },
  };
}

function makePayment(overrides?: {
  paymentStatus?: string;
  adPurchaseStatus?: string;
}) {
  return {
    id: "payment-1",
    status: overrides?.paymentStatus ?? "PENDING",
    adPurchase: {
      id: "adpurchase-1",
      status: overrides?.adPurchaseStatus ?? "PENDING",
      adPlan: { name: "Plano Ouro", durationDays: 30 },
      advertiser: { user: { name: "Anunciante", email: "anunciante@example.com" } },
    },
  };
}

describe("confirmAdPurchasePayment", () => {
  it("não faz nada quando o novo status é igual ao atual (redelivery)", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "PAID" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "PAID");

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está REFUNDED (terminal)", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "REFUNDED" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "PAID");

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está CHARGEBACK (terminal)", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "CHARGEBACK" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "PAID");

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("newStatus !== PAID: atualiza Payment.status mas não mexe no AdPurchase", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "PENDING" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "CANCELLED");

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "CANCELLED" },
    });
    expect(tx.adPurchase.update).not.toHaveBeenCalled();
    expect(result).toEqual({ changed: false });
  });

  it("newStatus === PAID mas AdPurchase já está PAID (idempotência): atualiza Payment.status mas não repete AdPurchase.update", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "PENDING", adPurchaseStatus: "PAID" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "PAID");

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "PAID" },
    });
    expect(tx.adPurchase.update).not.toHaveBeenCalled();
    expect(result).toEqual({ changed: false });
  });

  it("newStatus === PAID com AdPurchase ainda PENDING: confirma a compra e calcula endAt a partir de durationDays", async () => {
    const tx = makeTx();
    const payment = makePayment({ paymentStatus: "PENDING", adPurchaseStatus: "PENDING" });

    const result = await confirmAdPurchasePayment(tx as any, payment, "PAID");

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "PAID" },
    });
    expect(tx.adPurchase.update).toHaveBeenCalledTimes(1);
    const call = tx.adPurchase.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "adpurchase-1" });
    expect(call.data.status).toBe("PAID");
    const startAt: Date = call.data.startAt;
    const endAt: Date = call.data.endAt;
    expect(endAt.getTime() - startAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    expect(result).toEqual({
      changed: true,
      advertiserEmail: "anunciante@example.com",
      advertiserName: "Anunciante",
      planName: "Plano Ouro",
      endAt,
    });
  });
});
