import type { Prisma } from "@prisma/client";

export interface OrganizerReportFilter {
  organizerId: string;
  from: Date;
  to: Date;
  eventId?: string;
}

export function buildOrganizerPaymentWhere(
  filter: OrganizerReportFilter,
  orderStatus: "PAID" | "CANCELLED"
): Prisma.PaymentWhereInput {
  return {
    status: "PAID",
    paidAt: { gte: filter.from, lte: filter.to },
    order: {
      status: orderStatus,
      event: { organizerId: filter.organizerId },
      ...(filter.eventId ? { eventId: filter.eventId } : {}),
    },
  };
}

export function buildOrganizerOrderWhere(
  filter: OrganizerReportFilter,
  status?: "PAID"
): Prisma.OrderWhereInput {
  return {
    event: { organizerId: filter.organizerId },
    createdAt: { gte: filter.from, lte: filter.to },
    ...(status ? { status } : {}),
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}

export function buildOrganizerPayoutWhere(filter: OrganizerReportFilter): Prisma.TransferPayoutWhereInput {
  return {
    organizerId: filter.organizerId,
    createdAt: { gte: filter.from, lte: filter.to },
    ...(filter.eventId ? { eventId: filter.eventId } : {}),
  };
}
