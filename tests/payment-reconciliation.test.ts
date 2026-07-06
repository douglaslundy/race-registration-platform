import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getReconciliationAlertSettings: vi.fn() }));

import { reconcilePayments } from "@/lib/payment/reconciliation";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const pendingFixture = {
  id: "payment-1",
  providerPaymentId: "mp-1",
  status: "PENDING",
  order: { id: "order-1", event: { title: "Corrida Teste" } },
};

const paidFixture = {
  id: "payment-2",
  providerPaymentId: "mp-2",
  status: "PAID",
  orderId: "order-2",
  order: {
    id: "order-2",
    status: "PAID",
    event: { title: "Corrida Paga" },
    registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "CONFIRMED" }],
  },
};

const expiredFixture = {
  id: "payment-3",
  providerPaymentId: "mp-3",
  status: "EXPIRED",
  orderId: "order-3",
  order: {
    id: "order-3",
    status: "CANCELLED",
    event: { title: "Corrida Expirada" },
    registrations: [{ id: "reg-2", ticketBatchId: "batch-2", status: "CANCELLED" }],
  },
};

describe("reconcilePayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(dbMock));
  });

  it("consulta pagamentos PENDING mais antigos que o limiar", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    expect(dbMock.payment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", providerPaymentId: { not: null }, createdAt: { lte: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("detecta divergência PENDING sem corrigir sozinho", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({
      checked: 1,
      mismatches: [
        { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false },
      ],
    });
    expect(dbMock.payment.update).not.toHaveBeenCalled();
  });

  it("não reporta nada quando o status do gateway bate com o local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PENDING" }),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({ checked: 1, mismatches: [] });
  });

  it("continua processando os demais pagamentos PENDING quando um falha ao consultar o gateway", async () => {
    dbMock.payment.findMany
      .mockResolvedValueOnce([{ ...pendingFixture, id: "payment-1" }, { ...pendingFixture, id: "payment-4", providerPaymentId: "mp-4" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const checkPaymentStatus = vi.fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce({ status: "PAID" });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      checked: 2,
      mismatches: [
        { paymentId: "payment-4", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false },
      ],
    });
  });

  it("corrige automaticamente um PAID que o gateway diz estar REFUNDED", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "REFUNDED" }),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.$transaction).toHaveBeenCalled();
    expect(dbMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-2" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(result.mismatches).toEqual([
      { paymentId: "payment-2", orderId: "order-2", eventTitle: "Corrida Paga", localStatus: "PAID", gatewayStatus: "REFUNDED", corrected: true },
    ]);
  });

  it("corrige automaticamente um PAID que o gateway diz estar em CHARGEBACK", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "CHARGEBACK" }),
    } as any);

    const result = await reconcilePayments();

    expect(result.mismatches[0]).toEqual(
      expect.objectContaining({ gatewayStatus: "CHARGEBACK", corrected: true }),
    );
  });

  it("não mexe num pagamento PAID cujo status no gateway ainda é PAID", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.payment.update).not.toHaveBeenCalled();
    expect(result.mismatches).toEqual([]);
  });

  it("reativa um pagamento EXPIRED que o gateway diz estar PAID (aprovação atrasada)", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([expiredFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce({ status: "PAID" }),
    } as any);

    const result = await reconcilePayments();

    expect(dbMock.order.update).toHaveBeenCalledWith({ where: { id: "order-3" }, data: { status: "PAID" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-2" }, data: { soldCount: { increment: 1 } } });
    expect(result.mismatches).toEqual([
      { paymentId: "payment-3", orderId: "order-3", eventTitle: "Corrida Expirada", localStatus: "EXPIRED", gatewayStatus: "PAID", corrected: true },
    ]);
  });

  it("soma o total verificado das 3 varreduras", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([pendingFixture]).mockResolvedValueOnce([paidFixture]).mockResolvedValueOnce([expiredFixture]);
    // Cada verificação bate com o status local (sem divergência) — só valida a soma do "checked".
    const checkPaymentStatus = vi.fn()
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "PAID" })
      .mockResolvedValueOnce({ status: "EXPIRED" });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(result.checked).toBe(3);
    expect(result.mismatches).toEqual([]);
  });
});
