import type { Prisma } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";

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
    return { orderBy: { athlete: { name: normalizedDir } }, normalizedSort: "name", normalizedDir };
  }
  return { orderBy: { createdAt: normalizedDir }, normalizedSort: "date", normalizedDir };
}

export function buildRegistrationWhere(eventId: string, status?: string, q?: string): Prisma.RegistrationWhereInput {
  const query = q?.trim();
  const normalizedCpf = query ? normalizeCpf(query) : "";
  return {
    eventId,
    ...(status === "REFUNDED"
      ? { order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] } } } } }
      : status && VALID_REGISTRATION_STATUSES.includes(status)
        ? { status: status as never }
        : {}),
    ...(query
      ? {
          OR: [
            { orderId: { contains: query, mode: "insensitive" as const } },
            { athlete: { name: { contains: query, mode: "insensitive" as const } } },
            { athlete: { email: { contains: query, mode: "insensitive" as const } } },
            ...(normalizedCpf
              ? [{ athlete: { athleteProfile: { cpf: { contains: normalizedCpf } } } }]
              : []),
          ],
        }
      : {}),
  };
}
