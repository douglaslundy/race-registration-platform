import type { Prisma } from "@prisma/client";

export interface AdminAuditSearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  environment?: "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM";
  sort?: string;
  dir?: string;
}

export function buildAdminAuditWhere(
  params: Pick<AdminAuditSearchParams, "action" | "entity" | "userId" | "dateFrom" | "dateTo" | "environment">,
): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [];

  if (params.action) {
    filters.push({ action: { contains: params.action, mode: "insensitive" as const } });
  }

  if (params.entity) {
    filters.push({ entityType: params.entity });
  }

  if (params.userId) {
    filters.push({ userId: params.userId });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  if (params.environment === "SYSTEM") {
    filters.push({ userId: null });
  } else if (params.environment === "ADMIN" || params.environment === "ORGANIZER" || params.environment === "ATHLETE") {
    filters.push({ user: { role: params.environment } });
  }

  return filters.length ? { AND: filters } : {};
}

export function buildAdminAuditOrderBy(
  sort: string,
  dir: string,
): { orderBy: Prisma.AuditLogOrderByWithRelationInput[]; normalizedSort: string; normalizedDir: "asc" | "desc" } {
  const normalizedDir: "asc" | "desc" = dir === "asc" ? "asc" : "desc";

  switch (sort) {
    case "action":
      return { orderBy: [{ action: normalizedDir }, { createdAt: "desc" }], normalizedSort: "action", normalizedDir };
    case "entityType":
      return { orderBy: [{ entityType: normalizedDir }, { createdAt: "desc" }], normalizedSort: "entityType", normalizedDir };
    case "user":
      return { orderBy: [{ userId: normalizedDir }, { createdAt: "desc" }], normalizedSort: "user", normalizedDir };
    case "createdAt":
    default:
      return { orderBy: [{ createdAt: normalizedDir }], normalizedSort: "createdAt", normalizedDir };
  }
}

// Horário de Brasília é UTC-3 (sem horário de verão desde 2019). Os inputs de data dos
// filtros (<input type="date">) são dias de calendário no fuso do usuário (Brasília), não UTC.
const BRAZIL_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export function parseDateInput(dateValue?: string, endOfDay = false): Date | undefined {
  if (!dateValue) return undefined;
  const normalized = endOfDay ? `${dateValue}T23:59:59.999Z` : `${dateValue}T00:00:00.000Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // `parsed` foi calculado como se o dia informado fosse UTC. Como na verdade é um dia de
  // calendário em Brasília (UTC-3), o instante real é 3h mais tarde em UTC — sem esse ajuste,
  // um filtro "de 10/7" começava às 21h do dia 9 (horário de Brasília), incluindo registros
  // do dia anterior.
  return new Date(parsed.getTime() + BRAZIL_UTC_OFFSET_MS);
}

export function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
