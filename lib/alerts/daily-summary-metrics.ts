import { db } from "@/lib/db";

export interface AdminDailySummary {
  newUsersCount: number;
  newOrganizersCount: number;
  eventsCreatedCount: number;
  paidRegistrationsCount: number;
  grossRevenue: number;
  platformFeeAmount: number;
  /** Taxa de Serviço efetivamente cobrada (líquida, já com o desconto PIX). */
  serviceFeeAmount: number;
  /** Taxa de Serviço antes do desconto PIX (bruta). */
  serviceFeeOriginalAmount: number;
  /** Total de desconto PIX concedido no período (só a plataforma absorve). */
  pixDiscountAmount: number;
  payoutsGeneratedCount: number;
  payoutsGeneratedAmount: number;
  cancelledOrRefundedCount: number;
}

export interface OrganizerDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  soldOutBatchesCount: number;
}

export interface EventDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  vagasRestantes: number;
}

export async function getAdminDailySummary(dayStart: Date, dayEnd: Date): Promise<AdminDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [
    newUsersCount,
    newOrganizersCount,
    eventsCreatedCount,
    paidRegistrationsCount,
    grossRevenueAgg,
    feeAgg,
    payoutAgg,
    cancelledRegistrationsCount,
    refundedPaymentsCount,
  ] = await Promise.all([
    db.user.count({ where: { role: "ATHLETE", createdAt: period } }),
    db.user.count({ where: { role: "ORGANIZER", createdAt: period } }),
    db.event.count({ where: { createdAt: period } }),
    db.registration.count({ where: { status: "CONFIRMED", createdAt: period } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", createdAt: period } }),
    db.order.aggregate({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true, serviceFeeOriginalAmount: true, pixDiscountAmount: true },
      where: { status: "PAID", createdAt: period },
    }),
    db.transferPayout.aggregate({ _count: true, _sum: { grossAmount: true }, where: { createdAt: period } }),
    db.registration.count({ where: { cancellationRequestedAt: period } }),
    db.payment.count({ where: { status: { in: ["REFUNDED", "CHARGEBACK"] }, refundedAt: period } }),
  ]);

  return {
    newUsersCount,
    newOrganizersCount,
    eventsCreatedCount,
    paidRegistrationsCount,
    grossRevenue: grossRevenueAgg._sum.amount ?? 0,
    platformFeeAmount: feeAgg._sum.platformFeeAmount ?? 0,
    serviceFeeAmount: feeAgg._sum.paymentFeeAmount ?? 0,
    serviceFeeOriginalAmount: feeAgg._sum.serviceFeeOriginalAmount ?? 0,
    pixDiscountAmount: feeAgg._sum.pixDiscountAmount ?? 0,
    payoutsGeneratedCount: payoutAgg._count,
    payoutsGeneratedAmount: payoutAgg._sum.grossAmount ?? 0,
    cancelledOrRefundedCount: cancelledRegistrationsCount + refundedPaymentsCount,
  };
}

export async function getOrganizerDailySummary(
  organizerId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<OrganizerDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [paidRegistrationsCount, revenueAgg, couponsUsedCount, cancellationsRequestedCount, batches] =
    await Promise.all([
      db.registration.count({ where: { event: { organizerId }, status: "CONFIRMED", createdAt: period } }),
      db.order.aggregate({
        _sum: { subtotalAmount: true },
        where: { status: "PAID", event: { organizerId }, createdAt: period },
      }),
      db.order.count({ where: { event: { organizerId }, couponId: { not: null }, createdAt: period } }),
      db.registration.count({ where: { event: { organizerId }, cancellationRequestedAt: period } }),
      db.ticketBatch.findMany({
        where: { event: { organizerId }, active: true },
        select: { id: true, capacity: true, soldCount: true },
      }),
    ]);

  const soldOutBatchIds = batches.filter((b) => b.capacity > 0 && b.soldCount >= b.capacity).map((b) => b.id);

  // Não há um timestamp de "esgotou em" no schema. Como proxy, contamos lotes hoje
  // cheios que também tiveram ao menos uma inscrição confirmada nesta janela — não é
  // exato (o lote pode já estar cheio há dias), mas é o único sinal disponível sem
  // adicionar um novo campo ao TicketBatch.
  let soldOutBatchesCount = 0;
  if (soldOutBatchIds.length > 0) {
    const rows = await db.registration.findMany({
      where: { ticketBatchId: { in: soldOutBatchIds }, status: "CONFIRMED", createdAt: period },
      distinct: ["ticketBatchId"],
      select: { ticketBatchId: true },
    });
    soldOutBatchesCount = rows.length;
  }

  return {
    paidRegistrationsCount,
    grossRevenue: revenueAgg._sum.subtotalAmount ?? 0,
    couponsUsedCount,
    cancellationsRequestedCount,
    soldOutBatchesCount,
  };
}

export async function getEventDailySummary(eventId: string, dayStart: Date, dayEnd: Date): Promise<EventDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [paidRegistrationsCount, revenueAgg, couponsUsedCount, cancellationsRequestedCount, batches] =
    await Promise.all([
      db.registration.count({ where: { eventId, status: "CONFIRMED", createdAt: period } }),
      db.order.aggregate({
        _sum: { subtotalAmount: true },
        where: { status: "PAID", eventId, createdAt: period },
      }),
      db.order.count({ where: { eventId, couponId: { not: null }, createdAt: period } }),
      db.registration.count({ where: { eventId, cancellationRequestedAt: period } }),
      db.ticketBatch.findMany({
        where: { eventId, active: true },
        select: { capacity: true, soldCount: true },
      }),
    ]);

  const vagasRestantes = batches.reduce((sum, b) => sum + Math.max(0, b.capacity - b.soldCount), 0);

  return {
    paidRegistrationsCount,
    grossRevenue: revenueAgg._sum.subtotalAmount ?? 0,
    couponsUsedCount,
    cancellationsRequestedCount,
    vagasRestantes,
  };
}
