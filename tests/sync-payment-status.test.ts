import { describe, expect, it, vi } from "vitest";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";

function makeTx() {
  return {
    payment: { update: vi.fn() },
    order: { update: vi.fn() },
    registration: { update: vi.fn() },
    ticketBatch: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

describe("applyGatewayStatus", () => {
  it("não faz nada quando o novo status é igual ao atual", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      [],
      "PAID",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está REFUNDED (terminal)", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "REFUNDED" },
      { id: "ord-1", status: "REFUNDED" },
      [],
      "CHARGEBACK",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento já está CHARGEBACK (terminal)", async () => {
    const tx = makeTx();
    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "CHARGEBACK" },
      { id: "ord-1", status: "CANCELLED" },
      [],
      "REFUNDED",
      "webhook",
    );

    expect(result).toEqual({ changed: false });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it("PENDING -> PAID confirma a inscrição sem mexer na vaga", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      registrations,
      "PAID",
      "webhook",
    );

    expect(result).toEqual({ changed: true });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "PAID" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(tx.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("PENDING -> EXPIRED cancela a inscrição e libera a vaga", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      registrations,
      "EXPIRED",
      "webhook",
    );

    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("PAID -> REFUNDED cancela a inscrição, libera a vaga e marca refundedAt", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    const result = await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      registrations,
      "REFUNDED",
      "reconciliation",
    );

    expect(result).toEqual({ changed: true });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ status: "REFUNDED", refundedAt: expect.any(Date) }),
    });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "REFUNDED" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, action: "PAYMENT_STATUS_SYNCED_RECONCILIATION", entityType: "Payment", entityId: "pay-1" }),
    });
  });

  it("PAID -> CHARGEBACK trata igual a REFUNDED (libera vaga)", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PAID" },
      { id: "ord-1", status: "PAID" },
      registrations,
      "CHARGEBACK",
      "refund_check",
    );

    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "REFUNDED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PAYMENT_STATUS_SYNCED_REFUND_CHECK" }),
    });
  });

  it("EXPIRED -> PAID (aprovação atrasada) devolve a vaga e reconfirma a inscrição", async () => {
    const tx = makeTx();
    const registrations = [{ id: "reg-1", ticketBatchId: "batch-1" }];

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "EXPIRED" },
      { id: "ord-1", status: "CANCELLED" },
      registrations,
      "PAID",
      "reconciliation",
    );

    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "PAID" } });
    expect(tx.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(tx.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { increment: 1 } } });
  });

  it("guarda o rawPayload quando informado", async () => {
    const tx = makeTx();

    await applyGatewayStatus(
      tx as any,
      { id: "pay-1", status: "PENDING" },
      { id: "ord-1", status: "PENDING" },
      [],
      "PAID",
      "webhook",
      { rawPayload: { foo: "bar" } },
    );

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      data: expect.objectContaining({ rawPayload: { foo: "bar" } }),
    });
  });
});
