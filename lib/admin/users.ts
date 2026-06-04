import type { Prisma, UserRole } from "@prisma/client";

export interface AdminUserSearchParams {
  q?: string;
  role?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
  dir?: string;
}

export function buildAdminUserWhere(params: Pick<AdminUserSearchParams, "q" | "role" | "status" | "createdFrom" | "createdTo">): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [];

  if (params.q) {
    filters.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" as const } },
        { email: { contains: params.q, mode: "insensitive" as const } },
      ],
    });
  }

  if (params.role && params.role !== "ALL") {
    filters.push({ role: params.role as UserRole });
  }

  if (params.status === "ACTIVE") {
    filters.push({ active: true });
  }

  if (params.status === "BLOCKED") {
    filters.push({ active: false });
  }

  const createdFrom = parseDateInput(params.createdFrom, false);
  if (createdFrom) {
    filters.push({ createdAt: { gte: createdFrom } });
  }

  const createdTo = parseDateInput(params.createdTo, true);
  if (createdTo) {
    filters.push({ createdAt: { lte: createdTo } });
  }

  return filters.length ? { AND: filters } : {};
}

export function buildAdminUserOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.UserOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "name":
      return {
        orderBy: [{ name: normalizedDir }, { createdAt: "desc" }],
        normalizedSort: "name",
        normalizedDir,
      };
    case "email":
      return {
        orderBy: [{ email: normalizedDir }, { createdAt: "desc" }],
        normalizedSort: "email",
        normalizedDir,
      };
    case "role":
      return {
        orderBy: [{ role: normalizedDir }, { createdAt: "desc" }],
        normalizedSort: "role",
        normalizedDir,
      };
    case "active":
      return {
        orderBy: [{ active: normalizedDir }, { createdAt: "desc" }],
        normalizedSort: "active",
        normalizedDir,
      };
    case "registrations":
      return {
        orderBy: [{ registrations: { _count: normalizedDir } }, { createdAt: "desc" }],
        normalizedSort: "registrations",
        normalizedDir,
      };
    case "orders":
      return {
        orderBy: [{ orders: { _count: normalizedDir } }, { createdAt: "desc" }],
        normalizedSort: "orders",
        normalizedDir,
      };
    case "createdAt":
    default:
      return {
        orderBy: [{ createdAt: normalizedDir }, { name: "asc" }],
        normalizedSort: "createdAt",
        normalizedDir,
      };
  }
}

export function parseDateInput(dateValue?: string, endOfDay = false): Date | undefined {
  if (!dateValue) return undefined;

  const normalized = endOfDay ? `${dateValue}T23:59:59.999Z` : `${dateValue}T00:00:00.000Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
