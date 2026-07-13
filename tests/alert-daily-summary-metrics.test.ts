import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { getAdminDailySummary, getOrganizerDailySummary } from "@/lib/alerts/daily-summary-metrics";

const dbMock = db as any;

const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

describe("getAdminDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.count.mockResolvedValue(0);
    dbMock.event.count.mockResolvedValue(0);
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    dbMock.payment.count.mockResolvedValue(0);
    dbMock.order.aggregate.mockResolvedValue({ _sum: { platformFeeAmount: null, paymentFeeAmount: null } });
    dbMock.transferPayout.aggregate.mockResolvedValue({ _count: 0, _sum: { grossAmount: null } });
  });

  it("consulta novos usuários (papel ATHLETE) e novos organizadores (papel ORGANIZER) separadamente", async () => {
    dbMock.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(dbMock.user.count).toHaveBeenNthCalledWith(1, { where: { role: "ATHLETE", createdAt: { gte: dayStart, lt: dayEnd } } });
    expect(dbMock.user.count).toHaveBeenNthCalledWith(2, { where: { role: "ORGANIZER", createdAt: { gte: dayStart, lt: dayEnd } } });
    expect(result.newUsersCount).toBe(5);
    expect(result.newOrganizersCount).toBe(2);
  });

  it("soma taxa de plataforma e taxa de pagamento das ordens pagas no período", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { platformFeeAmount: 1000, paymentFeeAmount: 250 } });

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true },
      where: { status: "PAID", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.platformFeesRetained).toBe(1250);
  });

  it("usa 0 como padrão quando as agregações retornam null (dia sem atividade)", async () => {
    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(result.grossRevenue).toBe(0);
    expect(result.payoutsGeneratedAmount).toBe(0);
    expect(result.platformFeesRetained).toBe(0);
    expect(result.payoutsGeneratedCount).toBe(0);
  });

  it("soma inscrições com cancelamento solicitado e pagamentos estornados no período", async () => {
    dbMock.registration.count.mockResolvedValueOnce(7); // paidRegistrationsCount (CONFIRMED)
    dbMock.registration.count.mockResolvedValueOnce(3); // cancellationRequestedAt no período
    dbMock.payment.count.mockResolvedValueOnce(2); // REFUNDED/CHARGEBACK no período

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(result.paidRegistrationsCount).toBe(7);
    expect(result.cancelledOrRefundedCount).toBe(5);
    expect(dbMock.payment.count).toHaveBeenCalledWith({
      where: { status: { in: ["REFUNDED", "CHARGEBACK"] }, refundedAt: { gte: dayStart, lt: dayEnd } },
    });
  });
});

describe("getOrganizerDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
    dbMock.order.count.mockResolvedValue(0);
    dbMock.ticketBatch.findMany.mockResolvedValue([]);
    dbMock.registration.findMany.mockResolvedValue([]);
  });

  it("escopa inscrições pagas e receita ao organizerId informado", async () => {
    dbMock.registration.count.mockResolvedValueOnce(4);
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { totalAmount: 40000 } });

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.count).toHaveBeenCalledWith({
      where: { event: { organizerId: "org-1" }, status: "CONFIRMED", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { totalAmount: true },
      where: { status: "PAID", event: { organizerId: "org-1" }, createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.paidRegistrationsCount).toBe(4);
    expect(result.grossRevenue).toBe(40000);
  });

  it("conta lotes cheios (soldCount >= capacity) que tiveram ao menos uma inscrição confirmada no período", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([
      { id: "batch-full", capacity: 100, soldCount: 100 },
      { id: "batch-not-full", capacity: 100, soldCount: 40 },
      { id: "batch-zero-capacity", capacity: 0, soldCount: 0 },
    ]);
    dbMock.registration.findMany.mockResolvedValueOnce([{ ticketBatchId: "batch-full" }]);

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { ticketBatchId: { in: ["batch-full"] }, status: "CONFIRMED", createdAt: { gte: dayStart, lt: dayEnd } },
      distinct: ["ticketBatchId"],
      select: { ticketBatchId: true },
    });
    expect(result.soldOutBatchesCount).toBe(1);
  });

  it("não consulta inscrições de lotes quando nenhum lote está cheio", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([{ id: "batch-not-full", capacity: 100, soldCount: 40 }]);

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
    expect(result.soldOutBatchesCount).toBe(0);
  });
});
