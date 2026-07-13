import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePayoutStatus } from "@/lib/admin/update-payout-status";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("updatePayoutStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the payout does not exist", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce(null);
    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      actingUserId: "admin-1",
    });
    expect(result).toEqual({ ok: false, status: 404, error: "Repasse não encontrado" });
  });

  it("rejects a transition out of a terminal status", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" });
    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      actingUserId: "admin-1",
    });
    expect(result).toEqual({ ok: false, status: 400, error: "Repasse já está em estado final" });
  });

  it("moves PENDING to PROCESSING without setting processedAt or releasing orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "PROCESSING" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const result = await updatePayoutStatus({
      payoutId: "payout-1",
      newStatus: "PROCESSING",
      note: "Enviado para o banco",
      actingUserId: "admin-1",
    });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "PROCESSING", notes: "Enviado para o banco" },
    });
    expect(txMock.order.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, payout: { id: "payout-1", status: "PROCESSING" } });
  });

  it("moves PENDING to COMPLETED, sets processedAt, does not release orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    await updatePayoutStatus({ payoutId: "payout-1", newStatus: "COMPLETED", actingUserId: "admin-1" });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "COMPLETED", processedAt: expect.any(Date) },
    });
    expect(txMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("moves PROCESSING to FAILED, sets processedAt, and releases the payout's orders", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PROCESSING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "FAILED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    await updatePayoutStatus({ payoutId: "payout-1", newStatus: "FAILED", actingUserId: "admin-1" });

    expect(txMock.transferPayout.update).toHaveBeenCalledWith({
      where: { id: "payout-1" },
      data: { status: "FAILED", processedAt: expect.any(Date) },
    });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { payoutId: "payout-1" },
      data: { payoutId: null },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAYOUT_STATUS_UPDATED",
          entityType: "TransferPayout",
          entityId: "payout-1",
          metadata: { previousStatus: "PROCESSING", newStatus: "FAILED", note: null },
        }),
      }),
    );
  });
});
