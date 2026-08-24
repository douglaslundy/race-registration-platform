import { db } from "@/lib/db";

export interface OptedOutAthleteRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface OptedOutAthletesResult {
  rows: OptedOutAthleteRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Lista, paginada e pesquisável, dos atletas que optaram por NÃO receber mensagens promocionais
 * (`receivePromotionalMessages: false`) — usada pela aba de opt-outs em /admin/campanhas, pra o
 * operador ver quem está fora do alcance de campanhas automáticas/manuais sem precisar consultar
 * o banco diretamente. */
export async function listOptedOutAthletes(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<OptedOutAthletesResult> {
  const { q, page = 1, pageSize = 20 } = params;

  const searchClause = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { athleteProfile: { phone: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const where = { role: "ATHLETE" as const, receivePromotionalMessages: false, ...searchClause };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, email: true, athleteProfile: { select: { phone: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);

  return {
    rows: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.athleteProfile?.phone ?? null })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
