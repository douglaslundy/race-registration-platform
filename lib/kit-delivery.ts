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
  notes: string | null;
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
  pendingTotal: number;
}

export interface KitDeliveryListItem {
  id: string;
  participantName: string;
  participantCpf: string | null;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  notes: string | null;
  delivered: boolean;
  deliveredAt: Date | null;
  deliveredByName: string | null;
  receivedByName: string | null;
  receivedByDocument: string | null;
}

/** Lista COMPLETA das inscrições CONFIRMED de um evento com o status de entrega de kit de cada
 * uma — usada pela aba "Todos os inscritos" da tela de entrega de kits (visualização com filtro
 * entregues/pendentes e busca por nome/CPF, feita no cliente). Diferente de
 * `findRegistrationForKitDelivery` (busca pontual, 10 resultados) e de `getKitDeliveryProgress`
 * (contadores + só os pendentes). Ordenada por nome. */
export async function listKitDeliveries(eventId: string): Promise<KitDeliveryListItem[]> {
  const rows = await db.registration.findMany({
    where: { eventId, status: "CONFIRMED" },
    orderBy: { participantName: "asc" },
    select: {
      id: true,
      participantName: true,
      participantCpf: true,
      bibNumber: true,
      shirtSize: true,
      notes: true,
      category: { select: { name: true } },
      kitDelivery: {
        select: {
          deliveredAt: true,
          receivedByName: true,
          receivedByDocument: true,
          deliveredBy: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    participantName: r.participantName,
    participantCpf: r.participantCpf,
    bibNumber: r.bibNumber,
    shirtSize: r.shirtSize,
    categoryName: r.category?.name ?? null,
    notes: r.notes,
    delivered: r.kitDelivery !== null,
    deliveredAt: r.kitDelivery?.deliveredAt ?? null,
    deliveredByName: r.kitDelivery?.deliveredBy.name ?? null,
    receivedByName: r.kitDelivery?.receivedByName ?? null,
    receivedByDocument: r.kitDelivery?.receivedByDocument ?? null,
  }));
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
  const cpfClause = normalizedCpf.length === 11 ? [{ participantCpf: normalizedCpf }] : [];

  const registrations = await db.registration.findMany({
    where: {
      eventId,
      status: "CONFIRMED",
      OR: [
        { id: trimmed },
        { bibNumber: trimmed },
        { participantName: { contains: trimmed, mode: "insensitive" } },
        ...cpfClause,
      ],
    },
    take: 10,
    orderBy: { participantName: "asc" },
    include: {
      category: { select: { name: true } },
      kitDelivery: { include: { deliveredBy: { select: { name: true } } } },
    },
  });

  return registrations.map((r) => ({
    id: r.id,
    athleteName: r.participantName,
    bibNumber: r.bibNumber,
    shirtSize: r.shirtSize,
    categoryName: r.category?.name ?? null,
    status: r.status,
    delivered: r.kitDelivery !== null,
    deliveredAt: r.kitDelivery?.deliveredAt ?? null,
    deliveredByName: r.kitDelivery?.deliveredBy.name ?? null,
    receivedByName: r.kitDelivery?.receivedByName ?? null,
    notes: r.notes,
  }));
}

/** Progresso de entrega de kits de um evento: total de inscrições CONFIRMED, quantas já têm
 * KitDelivery (via count agregado, sem carregar as linhas inteiras), e a lista de pendentes —
 * limitada a `pendingLimit` linhas quando informado (usado pelo relatório JSON da UI, que só
 * precisa mostrar uma prévia), ou completa quando omitido (usado pelo export CSV, que precisa
 * de todo mundo). `pendingTotal` é sempre a contagem real de pendentes, mesmo quando `pending`
 * foi truncado — a UI usa isso pra saber se deve avisar "mostrando X de Y". */
export async function getKitDeliveryProgress(eventId: string, pendingLimit?: number): Promise<KitDeliveryProgress> {
  const [total, delivered, pendingTotal, pendingRows] = await Promise.all([
    db.registration.count({ where: { eventId, status: "CONFIRMED" } }),
    db.registration.count({ where: { eventId, status: "CONFIRMED", kitDelivery: { isNot: null } } }),
    db.registration.count({ where: { eventId, status: "CONFIRMED", kitDelivery: null } }),
    db.registration.findMany({
      where: { eventId, status: "CONFIRMED", kitDelivery: null },
      orderBy: { participantName: "asc" },
      ...(pendingLimit !== undefined ? { take: pendingLimit } : {}),
      include: {
        category: { select: { name: true } },
      },
    }),
  ]);

  const pending = pendingRows.map((r) => ({
    id: r.id,
    athleteName: r.participantName,
    bibNumber: r.bibNumber,
    categoryName: r.category?.name ?? null,
    email: r.participantEmail,
    phone: r.participantPhone ?? null,
  }));

  return { total, delivered, pending, pendingTotal };
}
