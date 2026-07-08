import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";

vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { attemptAutoRefund } from "@/lib/payment/auto-refund";

const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

describe("attemptAutoRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 'processed' e não escreve nada extra quando o gateway confirma o estorno", async () => {
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false });

    const result = await attemptAutoRefund({
      payment: { id: "pay-1", amount: 1000 },
      initiatedByUserId: "org-1",
      reason: "Contusão",
    });

    expect(result).toEqual({ outcome: "processed" });
    expect(refundPaymentMock).toHaveBeenCalledWith({ paymentId: "pay-1", initiatedByUserId: "org-1", reason: "Contusão" });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 'already_synced' quando o gateway já tinha processado o estorno antes", async () => {
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: true });

    const result = await attemptAutoRefund({ payment: { id: "pay-1", amount: 1000 }, initiatedByUserId: "org-1" });

    expect(result).toEqual({ outcome: "already_synced" });
  });

  it("quando o gateway falha, grava Refund FAILED, marca o pagamento como REFUND_PENDING e não lança exceção", async () => {
    refundPaymentMock.mockRejectedValueOnce(new Error("gateway indisponível"));
    const txRefundCreate = vi.fn();
    const txPaymentUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ refund: { create: txRefundCreate }, payment: { update: txPaymentUpdate } }),
    );

    const result = await attemptAutoRefund({
      payment: { id: "pay-1", amount: 1000 },
      initiatedByUserId: "org-1",
      reason: "Contusão",
    });

    expect(result).toEqual({ outcome: "failed", failureReason: "gateway indisponível" });
    expect(txRefundCreate).toHaveBeenCalledWith({
      data: {
        paymentId: "pay-1",
        amount: 1000,
        reason: "Contusão",
        status: "FAILED",
        failureReason: "gateway indisponível",
        initiatedByUserId: "org-1",
      },
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { status: "REFUND_PENDING" } });
  });

  it("usa uma mensagem padrão de erro quando o gateway lança algo que não é um Error", async () => {
    refundPaymentMock.mockRejectedValueOnce("timeout cru");
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ refund: { create: vi.fn() }, payment: { update: vi.fn() } }),
    );

    const result = await attemptAutoRefund({ payment: { id: "pay-1", amount: 1000 }, initiatedByUserId: "org-1" });

    expect(result).toEqual({ outcome: "failed", failureReason: "Erro desconhecido ao estornar" });
  });
});
