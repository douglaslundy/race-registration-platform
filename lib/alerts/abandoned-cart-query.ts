import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseDateInput } from "@/lib/admin/audit";

export interface AbandonedCartSearchParams {
  q?: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
}

export interface AbandonedCartRow {
  id: string;
  createdAt: Date;
  subtotalAmount: number;
  eventTitle: string;
  buyerName: string;
  buyerEmail: string;
  hasPhone: boolean;
  lastAlertSentAt: Date | null;
}

export function buildAbandonedCartWhere(
  params: Pick<AbandonedCartSearchParams, "q" | "event" | "dateFrom" | "dateTo">,
  scope?: { organizerUserId: string },
): Prisma.OrderWhereInput {
  const filters: Prisma.OrderWhereInput[] = [{ status: "PENDING" }];

  if (scope) {
    filters.push({ event: { organizer: { userId: scope.organizerUserId } } });
  }

  if (params.q) {
    filters.push({
      OR: [
        { buyer: { name: { contains: params.q, mode: "insensitive" as const } } },
        { buyer: { email: { contains: params.q, mode: "insensitive" as const } } },
        { event: { title: { contains: params.q, mode: "insensitive" as const } } },
      ],
    });
  }

  if (params.event) {
    filters.push({ event: { title: { contains: params.event, mode: "insensitive" as const } } });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  return { AND: filters };
}

export function buildAbandonedCartOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.OrderOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "amount":
      return { orderBy: [{ subtotalAmount: normalizedDir }, { createdAt: "desc" }], normalizedSort: "amount", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }], normalizedSort: "createdAt", normalizedDir };
  }
}

export async function listAbandonedCarts(
  where: Prisma.OrderWhereInput,
  orderBy: Prisma.OrderOrderByWithRelationInput[],
  skip: number,
  take: number,
): Promise<{ rows: AbandonedCartRow[]; total: number }> {
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy,
      skip,
      take,
      select: {
        id: true,
        createdAt: true,
        subtotalAmount: true,
        event: { select: { title: true } },
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      },
    }),
    db.order.count({ where }),
  ]);

  const alertLogs = orders.length
    ? await db.alertLog.findMany({
        where: { alertType: "ABANDONED_CART", entityType: "Order", entityId: { in: orders.map((o) => o.id) } },
        orderBy: { sentAt: "desc" },
      })
    : [];

  const lastAlertByOrder = new Map<string, Date>();
  for (const log of alertLogs) {
    if (!lastAlertByOrder.has(log.entityId)) lastAlertByOrder.set(log.entityId, log.sentAt);
  }

  const rows: AbandonedCartRow[] = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    subtotalAmount: o.subtotalAmount,
    eventTitle: o.event.title,
    buyerName: o.buyer.name,
    buyerEmail: o.buyer.email,
    hasPhone: Boolean(o.buyer.athleteProfile?.phone),
    lastAlertSentAt: lastAlertByOrder.get(o.id) ?? null,
  }));

  return { rows, total };
}
