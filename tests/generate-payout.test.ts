import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeEligiblePayoutTotals, generatePayout } from "@/lib/admin/generate-payout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("computeEligiblePayoutTotals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeros when there are no eligible orders", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 0 },
      _sum: { totalAmount: null, platformFeeAmount: null, paymentFeeAmount: null },
    });
    const result = await computeEligiblePayoutTotals("event-1");
    expect(result).toEqual({ orderCount: 0, grossAmount: 0, platformFee: 0, netAmount: 0 });
    expect(dbMock.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "PAID", payoutId: null } }),
    );
  });

  it("computes gross/platformFee/net from aggregated sums", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 2 },
      _sum: { totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    });
    const result = await computeEligiblePayoutTotals("event-1");
    expect(result).toEqual({ orderCount: 2, grossAmount: 10700, platformFee: 700, netAmount: 10000 });
  });
});

describe("generatePayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the event does not exist", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce(null);
    const result = await generatePayout("event-1", "admin-1");
    expect(result).toEqual({ ok: false, status: 404, error: "Evento não encontrado" });
  });

  it("returns 400 when there are no eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const result = await generatePayout("event-1", "admin-1");
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Nenhum pedido pago pendente de repasse para este evento.",
    });
  });

  it("creates the payout, claims the eligible orders, and writes the audit log", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([
      { id: "order-1", totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
      { id: "order-2", totalAmount: 5350, platformFeeAmount: 250, paymentFeeAmount: 100 },
    ]);

    const txMock = {
      transferPayout: {
        create: vi.fn().mockResolvedValueOnce({
          id: "payout-1",
          grossAmount: 16050,
          platformFee: 1050,
          netAmount: 15000,
        }),
      },
      order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 2 }) },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const result = await generatePayout("event-1", "admin-1");

    expect(txMock.transferPayout.create).toHaveBeenCalledWith({
      data: { eventId: "event-1", organizerId: "org-1", grossAmount: 16050, platformFee: 1050, netAmount: 15000 },
    });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["order-1", "order-2"] }, payoutId: null },
      data: { payoutId: "payout-1" },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "admin-1",
          action: "PAYOUT_GENERATED",
          entityType: "TransferPayout",
          entityId: "payout-1",
          metadata: { eventId: "event-1", orderCount: 2, grossAmount: 16050, netAmount: 15000 },
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      payout: { id: "payout-1", grossAmount: 16050, platformFee: 1050, netAmount: 15000 },
    });
  });

  it("returns 409 when a concurrent call already claimed some of the eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([
      { id: "order-1", totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
      { id: "order-2", totalAmount: 5350, platformFeeAmount: 250, paymentFeeAmount: 100 },
    ]);

    const txMock = {
      transferPayout: {
        create: vi.fn().mockResolvedValueOnce({
          id: "payout-1",
          grossAmount: 16050,
          platformFee: 1050,
          netAmount: 15000,
        }),
      },
      // Simulates a concurrent call having already claimed order-2 before this updateMany ran:
      // only 1 of the 2 requested rows actually match `payoutId: null` at claim time.
      order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }) },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => {
      try {
        return await fn(txMock);
      } catch (err) {
        throw err;
      }
    });

    const result = await generatePayout("event-1", "admin-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Alguns pedidos já foram incluídos em outro repasse enquanto este era gerado. Tente novamente.",
    });
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });
});
