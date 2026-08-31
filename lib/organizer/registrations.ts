import type { Prisma } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";
import { parseDateInput } from "@/lib/admin/audit";

export type RegistrationSortColumn = "name" | "date";
export type SortDirection = "asc" | "desc";

const VALID_REGISTRATION_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "TRANSFERRED",
  "WAITLISTED",
  "CANCELLATION_REQUESTED",
];

export function buildRegistrationOrderBy(
  sort: string,
  dir: string
): {
  orderBy: Prisma.RegistrationOrderByWithRelationInput;
  normalizedSort: RegistrationSortColumn;
  normalizedDir: SortDirection;
} {
  const normalizedDir: SortDirection = dir === "desc" ? "desc" : "asc";

  if (sort === "name") {
    return { orderBy: { participantName: normalizedDir }, normalizedSort: "name", normalizedDir };
  }
  return { orderBy: { createdAt: normalizedDir }, normalizedSort: "date", normalizedDir };
}

export interface RegistrationFilters {
  status?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function buildRegistrationWhere(
  eventId: string,
  filters: RegistrationFilters = {},
): Prisma.RegistrationWhereInput {
  const { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo } = filters;
  const query = q?.trim();
  const normalizedCpf = query ? normalizeCpf(query) : "";
  const isPaymentStatusFilter = status === "REFUNDED" || status === "REFUND_PENDING";

  // Both couponId and paymentMethod (and the REFUNDED/REFUND_PENDING status filters) live on the
  // related Order/Payment, and Tasks 3-4 let a user pick more than one of these at once — so they
  // must be merged into a single `order` filter object instead of each producing its own spread
  // key, which would let the last one silently overwrite the others.
  const paymentSomeFilter: Prisma.PaymentWhereInput = {};
  if (status === "REFUNDED") {
    paymentSomeFilter.status = { in: ["REFUNDED", "CHARGEBACK"] };
  } else if (status === "REFUND_PENDING") {
    paymentSomeFilter.status = "REFUND_PENDING";
  }
  if (paymentMethod) {
    paymentSomeFilter.method = paymentMethod as never;
  }

  const from = parseDateInput(dateFrom, false);
  const to = parseDateInput(dateTo, true);

  const orderFilter: Prisma.OrderWhereInput = {};
  // Sentinela "none" = inscrições cujo pedido não usou cupom nenhum.
  if (couponId === "none") orderFilter.couponId = null;
  else if (couponId) orderFilter.couponId = couponId;
  if (Object.keys(paymentSomeFilter).length > 0) {
    orderFilter.payments = { some: paymentSomeFilter };
  }

  return {
    eventId,
    ...(!isPaymentStatusFilter && status && VALID_REGISTRATION_STATUSES.includes(status)
      ? { status: status as never }
      : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(routeId ? { routeId } : {}),
    ...(ticketBatchId ? { ticketBatchId } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(Object.keys(orderFilter).length > 0 ? { order: orderFilter } : {}),
    ...(query
      ? {
          OR: [
            { orderId: { contains: query, mode: "insensitive" as const } },
            { participantName: { contains: query, mode: "insensitive" as const } },
            { participantEmail: { contains: query, mode: "insensitive" as const } },
            ...(normalizedCpf
              ? [{ participantCpf: { contains: normalizedCpf } }]
              : []),
          ],
        }
      : {}),
  };
}
