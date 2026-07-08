import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({
  getPaymentProvider: vi.fn(),
}));

const dbMock = db as any;
const getPaymentProviderMock = vi.mocked(getPaymentProvider);

describe("refundPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the payment does not exist", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce(null);
    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "Pagamento não encontrado",
    );
  });

  it("throws when the payment is not PAID", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PENDING",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [] },
    });
    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "Só é possível estornar pagamentos com status Pago",
    );
  });

  it("does not write anything when the gateway call fails", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [] },
    });
    const refundPaymentGateway = vi.fn().mockRejectedValueOnce(new Error("gateway down"));
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
      refundPayment: refundPaymentGateway,
    } as any);

    await expect(refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" })).rejects.toThrow(
      "gateway down",
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("cancels a still-confirmed registration and decrements soldCount on success", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [{ id: "reg-1", status: "CONFIRMED", ticketBatchId: "tb-1" }] },
    });
    const refundPaymentGateway = vi.fn().mockResolvedValueOnce({ providerRefundId: "mp-refund-1" });
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
      refundPayment: refundPaymentGateway,
    } as any);

    const txRefundCreate = vi.fn();
    const txPaymentUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txRegistrationUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { create: txRefundCreate },
        payment: { update: txPaymentUpdate },
        order: { update: txOrderUpdate },
        registration: { update: txRegistrationUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const result = await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1", reason: "atleta desistiu" });

    expect(result).toEqual({ alreadySynced: false });
    expect(refundPaymentGateway).toHaveBeenCalledWith({ providerPaymentId: "mp-1" });
    expect(txRefundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: "pay-1",
        amount: 1000,
        reason: "atleta desistiu",
        status: "PROCESSED",
        providerRefundId: "mp-refund-1",
        initiatedByUserId: "user-1",
      }),
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "REFUNDED" } });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { status: "CANCELLED" },
    });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({
      where: { id: "tb-1" },
      data: { soldCount: { decrement: 1 } },
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", action: "PAYMENT_REFUNDED", entityType: "Payment" }),
    });
  });

  it("does not touch an already-cancelled registration a second time", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { registrations: [{ id: "reg-1", status: "CANCELLED", ticketBatchId: "tb-1" }] },
    });
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
      refundPayment: vi.fn().mockResolvedValueOnce({ providerRefundId: "mp-refund-1" }),
    } as any);

    const txRegistrationUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { create: vi.fn() },
        payment: { update: vi.fn() },
        order: { update: vi.fn() },
        registration: { update: txRegistrationUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" });

    expect(txRegistrationUpdate).not.toHaveBeenCalled();
    expect(txTicketBatchUpdate).not.toHaveBeenCalled();
  });

  it("sincroniza localmente e não chama o gateway de novo quando já está estornado lá", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: {
        id: "ord-1",
        status: "PAID",
        registrations: [{ id: "reg-1", ticketBatchId: "tb-1" }],
      },
    });
    const refundPaymentGateway = vi.fn();
    getPaymentProviderMock.mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "REFUNDED" }),
      refundPayment: refundPaymentGateway,
    } as any);

    const txPaymentUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { update: txPaymentUpdate },
        order: { update: vi.fn() },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" });

    expect(result).toEqual({ alreadySynced: true });
    expect(refundPaymentGateway).not.toHaveBeenCalled();
    expect(txPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pay-1" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
  });
});
