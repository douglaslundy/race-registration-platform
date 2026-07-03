import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getReconciliationAlertSettings: vi.fn() }));

import { reconcilePayments } from "@/lib/payment/reconciliation";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const paymentFixture = {
  id: "payment-1",
  providerPaymentId: "mp-1",
  status: "PENDING",
  order: { id: "order-1", event: { title: "Corrida Teste" } },
};

describe("reconcilePayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
  });

  it("consulta pagamentos PENDING mais antigos que o limiar", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", providerPaymentId: { not: null }, createdAt: { lte: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("detecta divergência quando o status do gateway é diferente do local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({
      checked: 1,
      mismatches: [
        { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
      ],
    });
  });

  it("não reporta nada quando o status do gateway bate com o local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PENDING"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({ checked: 1, mismatches: [] });
  });

  it("nunca escreve no banco, mesmo quando encontra divergência", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    await reconcilePayments();

    expect(dbMock.payment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("continua processando os demais pagamentos quando um falha ao consultar o gateway", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([
      { ...paymentFixture, id: "payment-1" },
      { ...paymentFixture, id: "payment-2", providerPaymentId: "mp-2" },
    ]);
    const checkPaymentStatus = vi.fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce("PAID");
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      checked: 2,
      mismatches: [
        { paymentId: "payment-2", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
      ],
    });
  });
});
