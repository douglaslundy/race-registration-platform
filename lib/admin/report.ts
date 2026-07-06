import type { Prisma } from "@prisma/client";

export interface ReportPeriodFilter {
  from: Date;
  to: Date;
  eventId?: string;
}

export function buildReportPaymentWhere(
  filter: ReportPeriodFilter,
  orderStatus: "PAID" | "CANCELLED"
): Prisma.PaymentWhereInput {
  return {
    status: "PAID",
    paidAt: { gte: filter.from, lte: filter.to },
    order: {
      status: orderStatus,
      ...(filter.eventId ? { eventId: filter.eventId } : {}),
    },
  };
}

export function buildReportOrderWhere(
  filter: ReportPeriodFilter,
  status?: "PAID"
): Prisma.OrderWhereInput {
  return {
    createdAt: { gte: filter.from, lte: filter.to },
    ...(status ? { status } : {}),
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}

export function buildReportRegistrationWhere(filter: ReportPeriodFilter): Prisma.RegistrationWhereInput {
  return {
    createdAt: { gte: filter.from, lte: filter.to },
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}

export function buildReportRefundWhere(filter: ReportPeriodFilter): Prisma.PaymentWhereInput {
  return {
    status: { in: ["REFUNDED", "CHARGEBACK"] },
    refundedAt: { gte: filter.from, lte: filter.to },
    ...(filter.eventId ? { order: { eventId: filter.eventId } } : {}),
  };
}
