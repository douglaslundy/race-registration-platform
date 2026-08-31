import type { Prisma } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";

export interface ParticipantIdentity {
  name: string;
  email: string;
  phone: string | null;
  birthDate: Date | null;
  gender: string | null;
  cpf: string | null;
}

export async function resolveParticipantIdentity(
  tx: Prisma.TransactionClient,
  input: { proxyAthlete?: { name: string; email?: string; phone: string; birthDate: string; cpf: string } },
  athleteUserId: string,
): Promise<ParticipantIdentity> {
  const user = await tx.user.findUnique({
    where: { id: athleteUserId },
    select: {
      name: true,
      email: true,
      athleteProfile: { select: { phone: true, birthDate: true, gender: true, cpf: true } },
    },
  });
  if (input.proxyAthlete) {
    const p = input.proxyAthlete;
    return {
      name: p.name,
      email: p.email?.trim() || user?.email || "",
      phone: p.phone ?? null,
      birthDate: p.birthDate ? new Date(p.birthDate) : null,
      gender: null,
      cpf: p.cpf ? normalizeCpf(p.cpf) : null,
    };
  }
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.athleteProfile?.phone ?? null,
    birthDate: user?.athleteProfile?.birthDate ?? null,
    gender: user?.athleteProfile?.gender ?? null,
    cpf: user?.athleteProfile?.cpf ?? null,
  };
}

export function participantSnapshotData(id: ParticipantIdentity) {
  return {
    participantName: id.name,
    participantEmail: id.email,
    participantPhone: id.phone,
    participantBirthDate: id.birthDate,
    participantGender: id.gender,
    participantCpf: id.cpf ? normalizeCpf(id.cpf) : null,
  };
}

const FIELDS = [
  "participantName",
  "participantEmail",
  "participantPhone",
  "participantBirthDate",
  "participantGender",
  "participantCpf",
] as const;

export function pickParticipantChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (f in after && String(after[f] ?? "") !== String(before[f] ?? "")) {
      b[f] = before[f] ?? null;
      a[f] = after[f] ?? null;
    }
  }
  return { before: b, after: a };
}
