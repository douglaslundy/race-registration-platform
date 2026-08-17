import { db } from "./db";
import { normalizeCpf } from "./cpf";

export interface KitDeliverySearchResult {
  id: string;
  athleteName: string;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  status: string;
  delivered: boolean;
  deliveredAt: Date | null;
  deliveredByName: string | null;
  receivedByName: string | null;
}

export interface KitDeliveryProgress {
  total: number;
  delivered: number;
  pending: Array<{
    id: string;
    athleteName: string;
    bibNumber: string | null;
    categoryName: string | null;
    email: string;
    phone: string | null;
  }>;
}

/** Busca inscrições CONFIRMED de um evento pra retirada de kit — por id exato (vindo de QR lido
 * por câmera, leitor físico, ou colado), número de peito exato, nome (contains, case-insensitive)
 * ou CPF do atleta (só quando a query tem exatamente 11 dígitos após normalizar). Limitado a 10
 * resultados — busca por nome pode ter homônimos, mas a tela mostra um card por resultado. */
export async function findRegistrationForKitDelivery(
  eventId: string,
  query: string,
): Promise<KitDeliverySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalizedCpf = normalizeCpf(trimmed);
  const cpfClause = normalizedCpf.length === 11 ? [{ athlete: { athleteProfile: { cpf: normalizedCpf } } }] : [];

  const registrations = await db.registration.findMany({
    where: {
      eventId,
      status: "CONFIRMED",
      OR: [
        { id: trimmed },
        { bibNumber: trimmed },
        { athlete: { name: { contains: trimmed, mode: "insensitive" } } },
        ...cpfClause,
      ],
    },
    take: 10,
    orderBy: { athlete: { name: "asc" } },
    include: {
      athlete: { select: { name: true } },
      category: { select: { name: true } },
      kitDelivery: { include: { deliveredBy: { select: { name: true } } } },
    },
  });

  return registrations.map((r) => ({
    id: r.id,
    athleteName: r.proxyAthleteDisplayName ?? r.athlete.name,
    bibNumber: r.bibNumber,
    shirtSize: r.shirtSize,
    categoryName: r.category?.name ?? null,
    status: r.status,
    delivered: r.kitDelivery !== null,
    deliveredAt: r.kitDelivery?.deliveredAt ?? null,
    deliveredByName: r.kitDelivery?.deliveredBy.name ?? null,
    receivedByName: r.kitDelivery?.receivedByName ?? null,
  }));
}

/** Progresso de entrega de kits de um evento: total de inscrições CONFIRMED, quantas já têm
 * KitDelivery, e a lista completa das que ainda não têm — usado pelo card de progresso, pela
 * lista de pendentes na tela do organizador/admin, e pelo export CSV. */
export async function getKitDeliveryProgress(eventId: string): Promise<KitDeliveryProgress> {
  const registrations = await db.registration.findMany({
    where: { eventId, status: "CONFIRMED" },
    orderBy: { athlete: { name: "asc" } },
    include: {
      athlete: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      category: { select: { name: true } },
      kitDelivery: { select: { id: true } },
    },
  });

  const delivered = registrations.filter((r) => r.kitDelivery !== null).length;
  const pending = registrations
    .filter((r) => r.kitDelivery === null)
    .map((r) => ({
      id: r.id,
      athleteName: r.proxyAthleteDisplayName ?? r.athlete.name,
      bibNumber: r.bibNumber,
      categoryName: r.category?.name ?? null,
      email: r.athlete.email,
      phone: r.athlete.athleteProfile?.phone ?? null,
    }));

  return { total: registrations.length, delivered, pending };
}
