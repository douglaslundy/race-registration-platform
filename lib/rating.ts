import { db } from "@/lib/db";

export interface RatingItem {
  key: string;
  label: string;
  points: number;
  done: boolean;
}

export const POINTS_REGISTRATION = 10;
export const POINTS_RESULT = 20;
export const POINTS_ORGANIZED_EVENT = 30;

type AthleteData = {
  birthDate?: Date | null;
  cpf?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  gender?: string | null;
  preferredShirtSize?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  teamName?: string | null;
};

type OrganizerData = {
  companyName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

const filled = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v != null);

/** Itens de cadastro do atleta (pontos únicos, pelo preenchimento atual do perfil). */
export function athleteProfileItems(p: AthleteData | null, avatarUrl: string | null): RatingItem[] {
  const required = [p?.birthDate, p?.cpf, p?.phone, p?.postalCode, p?.street, p?.number, p?.neighborhood, p?.city, p?.state];
  return [
    { key: "profile:required", label: "Dados obrigatórios do cadastro", points: 40, done: required.every(filled) },
    { key: "profile:avatar", label: "Foto de perfil", points: 20, done: filled(avatarUrl) },
    { key: "profile:emergency", label: "Contato de emergência", points: 10, done: filled(p?.emergencyName) && filled(p?.emergencyPhone) },
    { key: "profile:gender", label: "Gênero", points: 5, done: filled(p?.gender) },
    { key: "profile:shirt", label: "Tamanho de camiseta", points: 5, done: filled(p?.preferredShirtSize) },
    { key: "profile:medical", label: "Informações médicas", points: 5, done: filled(p?.medicalNotes) },
    { key: "profile:team", label: "Equipe", points: 5, done: filled(p?.teamName) },
  ];
}

export function organizerProfileItems(p: OrganizerData | null, avatarUrl: string | null): RatingItem[] {
  return [
    { key: "profile:avatar", label: "Logo / foto de perfil", points: 20, done: filled(avatarUrl) },
    { key: "profile:company", label: "Nome da empresa", points: 10, done: filled(p?.companyName) },
    { key: "profile:cnpj", label: "CNPJ", points: 15, done: filled(p?.cnpj) },
    { key: "profile:phone", label: "Telefone", points: 10, done: filled(p?.phone) },
    { key: "profile:website", label: "Site", points: 5, done: filled(p?.website) },
    { key: "profile:bio", label: "Apresentação (bio)", points: 10, done: filled(p?.bio) },
  ];
}

export function completionPercent(items: RatingItem[]): number {
  const total = items.reduce((s, i) => s + i.points, 0);
  if (total === 0) return 0;
  return Math.round((items.filter((i) => i.done).reduce((s, i) => s + i.points, 0) / total) * 100);
}

export async function getProfileItems(userId: string, role: string): Promise<RatingItem[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, athleteProfile: true, organizerProfile: true },
  });
  if (!user) return [];
  if (role === "ORGANIZER") return organizerProfileItems(user.organizerProfile, user.avatarUrl);
  if (role === "ATHLETE") return athleteProfileItems(user.athleteProfile, user.avatarUrl);
  return [];
}

/**
 * Recalcula as conquistas do usuário a partir dos dados atuais e grava as novas (idempotente:
 * `@@unique([userId, key])` + skipDuplicates). Pontos nunca diminuem — apagar um campo não tira
 * pontos já ganhos. Serve também de passagem retroativa.
 */
export async function syncRating(userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return 0;

  const earned = new Map<string, number>();
  for (const item of await getProfileItems(userId, user.role)) {
    if (item.done) earned.set(item.key, item.points);
  }

  if (user.role === "ATHLETE") {
    const regs = await db.registration.findMany({
      where: { athleteUserId: userId, status: "CONFIRMED" },
      select: { id: true, eventId: true, bibNumber: true },
    });
    for (const r of regs) earned.set(`reg:${r.id}`, POINTS_REGISTRATION);
    const withBib = regs.filter((r) => r.bibNumber);
    if (withBib.length > 0) {
      const results = await db.raceResult.findMany({
        where: { OR: withBib.map((r) => ({ eventId: r.eventId, bibNumber: r.bibNumber as string })) },
        select: { eventId: true, bibNumber: true },
      });
      const done = new Set(results.map((x) => `${x.eventId}:${x.bibNumber}`));
      for (const r of withBib) if (done.has(`${r.eventId}:${r.bibNumber}`)) earned.set(`result:${r.id}`, POINTS_RESULT);
    }
  } else if (user.role === "ORGANIZER") {
    const events = await db.event.findMany({
      where: { organizer: { userId }, status: "COMPLETED" },
      select: { id: true },
    });
    for (const e of events) earned.set(`event:${e.id}`, POINTS_ORGANIZED_EVENT);
  }

  if (earned.size > 0) {
    await db.ratingEvent.createMany({
      data: [...earned].map(([key, points]) => ({ userId, key, points })),
      skipDuplicates: true,
    });
  }
  const sum = await db.ratingEvent.aggregate({ where: { userId }, _sum: { points: true } });
  const total = sum._sum.points ?? 0;
  await db.user.update({ where: { id: userId }, data: { ratingPoints: total } });
  return total;
}

/** Fire-and-forget: nunca derruba a ação que disparou. */
export function syncRatingSafe(userId: string): void {
  void syncRating(userId).catch((err) => console.error("[rating] sync falhou", userId, err));
}

export async function getRatingSummary(userId: string, role: string) {
  const points = await syncRating(userId);
  const items = await getProfileItems(userId, role);
  return { points, percent: completionPercent(items), items };
}
