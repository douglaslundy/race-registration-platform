import type { Prisma, UserRole } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";
import { parseDateInput } from "@/lib/admin/audit";

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
    const normalizedCpf = normalizeCpf(params.q);
    filters.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" as const } },
        { email: { contains: params.q, mode: "insensitive" as const } },
        ...(normalizedCpf
          ? [
              { cpf: { contains: normalizedCpf } },
              { athleteProfile: { cpf: { contains: normalizedCpf } } },
            ]
          : []),
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
    case "lastLoginAt":
      // nulls: "last" — quem nunca acessou aparece por último em qualquer direção, em vez de
      // "furar a fila" no topo quando ordenado desc (comportamento padrão do Postgres pra NULL).
      return {
        orderBy: [{ lastLoginAt: { sort: normalizedDir, nulls: "last" } }, { createdAt: "desc" }],
        normalizedSort: "lastLoginAt",
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

export function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * I-2: `targetId` do código 2FA para a CRIAÇÃO de usuário (`POST /api/admin/users`).
 * Não há id de usuário ainda, então usamos um sentinela fixo — o mesmo em `request-code`
 * e na verificação, para o `verifySensitiveActionCode` casar `record.targetId`.
 */
export const USER_CREATE_2FA_TARGET_ID = "__create__";
