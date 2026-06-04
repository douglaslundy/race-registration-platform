import type { Prisma } from "@prisma/client";
import { parseDateInput } from "@/lib/admin/audit";

export interface AdminPaymentSearchParams {
  q?: string;
  status?: string;
  method?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function buildAdminPaymentWhere(params: AdminPaymentSearchParams | string): Prisma.PaymentWhereInput {
  if (typeof params === "string") {
    return params ? { status: params as never } : {};
  }

  const filters: Prisma.PaymentWhereInput[] = [];

  if (params.q) {
    filters.push({
      OR: [
        { providerPaymentId: { contains: params.q, mode: "insensitive" as const } },
        { order: { buyer: { name: { contains: params.q, mode: "insensitive" as const } } } },
        { order: { buyer: { email: { contains: params.q, mode: "insensitive" as const } } } },
        { order: { registrations: { some: { event: { title: { contains: params.q, mode: "insensitive" as const } } } } } },
      ],
    });
  }

  if (params.status && params.status !== "ALL") {
    filters.push({ status: params.status as never });
  }

  if (params.method && params.method !== "ALL") {
    filters.push({ method: params.method as never });
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

export function buildAdminPaymentOrderBy(sort: string, dir: string): { orderBy: Prisma.PaymentOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "amount":
      return { orderBy: [{ amount: normalizedDir }, { createdAt: "desc" }], normalizedSort: "amount", normalizedDir };
    case "method":
      return { orderBy: [{ method: normalizedDir }, { createdAt: "desc" }], normalizedSort: "method", normalizedDir };
    case "status":
      return { orderBy: [{ status: normalizedDir }, { createdAt: "desc" }], normalizedSort: "status", normalizedDir };
    case "provider":
      return { orderBy: [{ provider: normalizedDir }, { createdAt: "desc" }], normalizedSort: "provider", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }], normalizedSort: "createdAt", normalizedDir };
  }
}

export function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
