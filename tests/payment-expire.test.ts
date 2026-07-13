import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import {
  cancelExpiredPayment,
  expirePendingPayments,
  cancelAbandonedOrder,
  expireAbandonedOrders,
} from "@/lib/payment/expire-payments";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const dbMock = db as any;

describe("cancelExpiredPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false e não faz mais nada quando o pagamento não está mais PENDING", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 });
    const orderUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow: vi.fn() },
        order: { update: orderUpdate },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await cancelExpiredPayment("payment-1");

    expect(result).toBe(false);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("cancela o pedido e as inscrições PENDING_PAYMENT, libera a vaga do lote e grava auditoria", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      orderId: "order-1",
      order: {
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
      },
    });
    const orderUpdate = vi.fn();
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    const auditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow },
        order: { update: orderUpdate },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: auditLogCreate },
      }),
    );

    const result = await cancelExpiredPayment("payment-1");

    expect(result).toBe(true);
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    expect(registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(ticketBatchUpdate).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: "PAYMENT_AUTO_EXPIRED", entityType: "Payment", entityId: "payment-1", metadata: { orderId: "order-1" } },
    });
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não mexe em inscrições que não estão mais PENDING_PAYMENT", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      orderId: "order-1",
      order: {
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "CANCELLED" }],
      },
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { updateMany, findUniqueOrThrow },
        order: { update: vi.fn() },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await cancelExpiredPayment("payment-1");

    expect(registrationUpdate).not.toHaveBeenCalled();
    expect(ticketBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("expirePendingPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca pagamentos PENDING com prazo vencido", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", expiresAt: { not: null, lt: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await expirePendingPayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("conta quantos pagamentos foram realmente expirados", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([{ id: "payment-1" }, { id: "payment-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ orderId: "order-1", order: { registrations: [] } }),
          },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      )
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: { updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }), findUniqueOrThrow: vi.fn() },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expirePendingPayments();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });

  it("continua processando os demais quando um pagamento falha", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([{ id: "payment-1" }, { id: "payment-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      })
      .mockImplementationOnce(async (fn: any) =>
        fn({
          payment: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ orderId: "order-2", order: { registrations: [] } }),
          },
          order: { update: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expirePendingPayments();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });
});

describe("cancelAbandonedOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false e não faz mais nada quando o pedido não está mais PENDING", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 });
    const findUniqueOrThrow = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany, findUniqueOrThrow },
        registration: { update: vi.fn() },
        ticketBatch: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );

    const result = await cancelAbandonedOrder("order-1");

    expect(result).toBe(false);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("cancela o pedido e as inscrições PENDING_PAYMENT, libera a vaga do lote e grava auditoria", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    const auditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany, findUniqueOrThrow },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: auditLogCreate },
      }),
    );

    const result = await cancelAbandonedOrder("order-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "order-1", status: "PENDING" }, data: { status: "CANCELLED" } });
    expect(registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(ticketBatchUpdate).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: { action: "ORDER_ABANDONED_EXPIRED", entityType: "Order", entityId: "order-1", metadata: {} },
    });
  });

  it("não mexe em inscrições que não estão mais PENDING_PAYMENT", async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValueOnce({
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "CONFIRMED" }],
    });
    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }), findUniqueOrThrow },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    await cancelAbandonedOrder("order-1");

    expect(registrationUpdate).not.toHaveBeenCalled();
    expect(ticketBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("expireAbandonedOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca pedidos PENDING sem payment com prazo vencido", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          expiresAt: { not: null, lt: expect.any(Date) },
          payments: { none: {} },
        }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders({ organizerUserId: "org-1" });

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ event: { organizer: { userId: "org-1" } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await expireAbandonedOrders();

    const call = dbMock.order.findMany.mock.calls[0][0];
    expect(call.where.event).toBeUndefined();
  });

  it("conta quantos pedidos foram realmente expirados", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ registrations: [] }),
          },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      )
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }), findUniqueOrThrow: vi.fn() },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expireAbandonedOrders();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });

  it("continua processando os demais quando um pedido falha", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([{ id: "order-1" }, { id: "order-2" }]);
    dbMock.$transaction
      .mockImplementationOnce(async () => {
        throw new Error("db down");
      })
      .mockImplementationOnce(async (fn: any) =>
        fn({
          order: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ registrations: [] }),
          },
          registration: { update: vi.fn() },
          ticketBatch: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }),
      );

    const result = await expireAbandonedOrders();

    expect(result).toEqual({ checked: 2, expired: 1 });
  });
});
