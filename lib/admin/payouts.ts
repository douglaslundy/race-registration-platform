import type { Prisma } from "@prisma/client";
import { escapeCsvValue, parseDateInput } from "@/lib/admin/audit";

export interface AdminPayoutSearchParams {
  q?: string;
  status?: string;
  event?: string;
  organizer?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
}

export function buildAdminPayoutWhere(
  params: Pick<AdminPayoutSearchParams, "q" | "status" | "event" | "organizer" | "dateFrom" | "dateTo">,
): Prisma.TransferPayoutWhereInput {
  const filters: Prisma.TransferPayoutWhereInput[] = [];

  if (params.q) {
    filters.push({
      OR: [
        { event: { title: { contains: params.q, mode: "insensitive" as const } } },
        { organizer: { user: { name: { contains: params.q, mode: "insensitive" as const } } } },
      ],
    });
  }

  if (params.status && params.status !== "ALL") {
    filters.push({ status: params.status as Prisma.TransferPayoutWhereInput["status"] });
  }

  if (params.event) {
    filters.push({ event: { title: { contains: params.event, mode: "insensitive" as const } } });
  }

  if (params.organizer) {
    filters.push({ organizer: { user: { name: { contains: params.organizer, mode: "insensitive" as const } } } });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  return filters.length ? { AND: filters } : {};
}

export function buildAdminPayoutOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.TransferPayoutOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "event":
      return { orderBy: [{ event: { title: normalizedDir } }, { createdAt: "desc" }], normalizedSort: "event", normalizedDir };
    case "organizer":
      return { orderBy: [{ organizer: { user: { name: normalizedDir } } }, { createdAt: "desc" }], normalizedSort: "organizer", normalizedDir };
    case "grossAmount":
      return { orderBy: [{ grossAmount: normalizedDir }, { createdAt: "desc" }], normalizedSort: "grossAmount", normalizedDir };
    case "netAmount":
      return { orderBy: [{ netAmount: normalizedDir }, { createdAt: "desc" }], normalizedSort: "netAmount", normalizedDir };
    case "status":
      return { orderBy: [{ status: normalizedDir }, { createdAt: "desc" }], normalizedSort: "status", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }], normalizedSort: "createdAt", normalizedDir };
  }
}

export { escapeCsvValue };

export function hasPostPayoutRefund(orders: { status: string }[]): boolean {
  return orders.length > 0;
}
