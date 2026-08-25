import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { attemptAutoRefund } from "@/lib/payment/auto-refund";
import { notifyRegistrationCancelledByStaff } from "@/lib/alerts/registration-cancelled-by-staff";

vi.mock("@/lib/payment/auto-refund", () => ({ attemptAutoRefund: vi.fn() }));
vi.mock("@/lib/alerts/registration-cancelled-by-staff", () => ({ notifyRegistrationCancelledByStaff: vi.fn() }));

import { decideRegistrationCancellation, cancelConfirmedRegistrationDirectly } from "@/lib/registrations/cancellation-decision-service";

const dbMock = db as any;
const attemptAutoRefundMock = vi.mocked(attemptAutoRefund);
const notifyMock = vi.mocked(notifyRegistrationCancelledByStaff);

const baseRegistration = {
  id: "reg-1",
  status: "CANCELLATION_REQUESTED",
  ticketBatchId: "tb-1",
  orderId: "ord-1",
  cancellationReason: "Contusão no joelho",
  order: { payments: [] as { id: string; amount: number }[] },
};

describe("decideRegistrationCancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 quando a inscrição não é encontrada no escopo informado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Inscrição não encontrada" });
  });

  it("retorna 400 quando a inscrição não está com solicitação pendente", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...baseRegistration, status: "CANCELLED" });

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "user-1",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Esta inscrição não possui uma solicitação de cancelamento pendente",
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("REJECT volta a inscrição para CONFIRMED e não tenta estornar", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ registration: { update: txRegistrationUpdate }, auditLog: { create: txAuditLogCreate } }),
    );

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "REJECT",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REJECTED" }) }),
    );
    expect(attemptAutoRefundMock).not.toHaveBeenCalled();
  });

  it("APPROVE sem pagamento PAID cancela a inscrição e retorna refund 'not_applicable'", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "not_applicable" });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(attemptAutoRefundMock).not.toHaveBeenCalled();
  });

  it("APPROVE com pagamento PAID tenta o estorno automático e repassa o resultado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      order: { payments: [{ id: "pay-1", amount: 5000 }] },
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: vi.fn() },
        order: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
    attemptAutoRefundMock.mockResolvedValueOnce({ outcome: "failed", failureReason: "gateway indisponível" });

    const result = await decideRegistrationCancellation({
      where: { id: "reg-1" },
      decision: "APPROVE",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "failed" });
    expect(attemptAutoRefundMock).toHaveBeenCalledWith({
      payment: { id: "pay-1", amount: 5000 },
      initiatedByUserId: "org-1",
      reason: "Contusão no joelho",
    });
  });
});

describe("cancelConfirmedRegistrationDirectly", () => {
  const confirmedRegistration = {
    id: "reg-1",
    status: "CONFIRMED",
    ticketBatchId: "tb-1",
    orderId: "ord-1",
    order: { payments: [] as { id: string; amount: number }[] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 404 quando a inscrição não é encontrada no escopo informado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const result = await cancelConfirmedRegistrationDirectly({
      where: { id: "reg-1" },
      reason: "Pedido da comissão organizadora",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: false, status: 404, error: "Inscrição não encontrada" });
  });

  it("retorna 400 quando a inscrição não está CONFIRMED", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...confirmedRegistration, status: "PENDING_PAYMENT" });

    const result = await cancelConfirmedRegistrationDirectly({
      where: { id: "reg-1" },
      reason: "Pedido da comissão organizadora",
      actingUserId: "org-1",
    });

    expect(result.ok).toBe(false);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("sem pagamento PAID: cancela inscrição/pedido, libera vaga, avisa o atleta e retorna refund 'not_applicable'", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(confirmedRegistration);
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
      }),
    );

    const result = await cancelConfirmedRegistrationDirectly({
      where: { id: "reg-1" },
      reason: "Pedido da comissão organizadora",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "not_applicable" });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { status: "CANCELLED", cancellationReason: "Pedido da comissão organizadora" },
    });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(notifyMock).toHaveBeenCalledWith("reg-1");
    expect(attemptAutoRefundMock).not.toHaveBeenCalled();
  });

  it("com pagamento PAID: tenta o estorno automático e repassa o resultado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...confirmedRegistration,
      order: { payments: [{ id: "pay-1", amount: 5000 }] },
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({ registration: { update: vi.fn() }, order: { update: vi.fn() }, ticketBatch: { update: vi.fn() } }),
    );
    attemptAutoRefundMock.mockResolvedValueOnce({ outcome: "processed" });

    const result = await cancelConfirmedRegistrationDirectly({
      where: { id: "reg-1" },
      reason: "Pedido da comissão organizadora",
      actingUserId: "org-1",
    });

    expect(result).toEqual({ ok: true, refund: "processed" });
    expect(attemptAutoRefundMock).toHaveBeenCalledWith({
      payment: { id: "pay-1", amount: 5000 },
      initiatedByUserId: "org-1",
      reason: "Pedido da comissão organizadora",
    });
  });
});
