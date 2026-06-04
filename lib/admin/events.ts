import type { EventModality, Prisma, EventStatus } from "@prisma/client";

export interface AdminEventSearchParams {
  q?: string;
  status?: string;
  modality?: string;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
}

export function buildAdminEventWhere(params: Pick<AdminEventSearchParams, "q" | "status" | "modality" | "city" | "dateFrom" | "dateTo">): Prisma.EventWhereInput {
  const filters: Prisma.EventWhereInput[] = [];

  if (params.q) {
    filters.push({
      OR: [
        { title: { contains: params.q, mode: "insensitive" as const } },
        { slug: { contains: params.q, mode: "insensitive" as const } },
        { city: { contains: params.q, mode: "insensitive" as const } },
        {
          organizer: {
            is: {
              user: {
                is: {
                  OR: [
                    { name: { contains: params.q, mode: "insensitive" as const } },
                    { email: { contains: params.q, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          },
        },
      ],
    });
  }

  if (params.status && params.status !== "ALL") {
    filters.push({ status: params.status as EventStatus });
  }

  if (params.modality && params.modality !== "ALL") {
    filters.push({ modality: params.modality as EventModality });
  }

  if (params.city) {
    filters.push({ city: { contains: params.city, mode: "insensitive" as const } });
  }

  const dateFrom = parseDateInput(params.dateFrom, false);
  if (dateFrom) {
    filters.push({ startAt: { gte: dateFrom } });
  }

  const dateTo = parseDateInput(params.dateTo, true);
  if (dateTo) {
    filters.push({ startAt: { lte: dateTo } });
  }

  return filters.length ? { AND: filters } : {};
}

export function buildAdminEventOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.EventOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "title":
      return { orderBy: [{ title: normalizedDir }, { createdAt: "desc" }], normalizedSort: "title", normalizedDir };
    case "startAt":
      return { orderBy: [{ startAt: normalizedDir }, { createdAt: "desc" }], normalizedSort: "startAt", normalizedDir };
    case "city":
      return { orderBy: [{ city: normalizedDir }, { createdAt: "desc" }], normalizedSort: "city", normalizedDir };
    case "status":
      return { orderBy: [{ status: normalizedDir }, { createdAt: "desc" }], normalizedSort: "status", normalizedDir };
    case "registrations":
      return { orderBy: [{ registrations: { _count: normalizedDir } }, { createdAt: "desc" }], normalizedSort: "registrations", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }, { title: "asc" }], normalizedSort: "createdAt", normalizedDir };
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
