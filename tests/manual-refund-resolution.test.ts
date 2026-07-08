import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";

const dbMock = db as any;

describe("resolveRefundManually", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 quando o pagamento não é encontrado no escopo informado", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce(null);

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Pagamento não encontrado" });
  });

  it("retorna 400 quando o pagamento não está com estorno pendente", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "PAID" });

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "nota",
    });

    expect(result).toEqual({ ok: false, status: 400, error: "Este pagamento não está com estorno pendente" });
  });

  it("retorna 400 quando não há registro de estorno FAILED para atualizar", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "REFUND_PENDING" });
    dbMock.refund.findFirst.mockResolvedValueOnce(null);

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "nota",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Nenhum registro de estorno pendente encontrado para este pagamento",
    });
  });

  it("marca o Refund como MANUAL e o Payment como REFUNDED", async () => {
    dbMock.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", status: "REFUND_PENDING" });
    dbMock.refund.findFirst.mockResolvedValueOnce({ id: "refund-1", status: "FAILED" });
    const txRefundUpdate = vi.fn();
    const txPaymentUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        refund: { update: txRefundUpdate },
        payment: { update: txPaymentUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const result = await resolveRefundManually({
      where: { id: "pay-1" },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });

    expect(result).toEqual({ ok: true });
    expect(txRefundUpdate).toHaveBeenCalledWith({
      where: { id: "refund-1" },
      data: expect.objectContaining({ status: "MANUAL", resolutionNote: "Estorno feito via PIX manual" }),
    });
    expect(txPaymentUpdate).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "org-1", action: "PAYMENT_REFUND_MANUAL", entityType: "Payment", entityId: "pay-1" }),
      }),
    );
  });
});
