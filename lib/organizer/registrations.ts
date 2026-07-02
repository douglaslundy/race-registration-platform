import type { Prisma } from "@prisma/client";

export type RegistrationSortColumn = "name" | "date";
export type SortDirection = "asc" | "desc";

const VALID_REGISTRATION_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "TRANSFERRED",
  "WAITLISTED",
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

export function buildRegistrationWhere(eventId: string, status?: string): Prisma.RegistrationWhereInput {
  if (status && VALID_REGISTRATION_STATUSES.includes(status)) {
    return { eventId, status: status as never };
  }
  return { eventId };
}
