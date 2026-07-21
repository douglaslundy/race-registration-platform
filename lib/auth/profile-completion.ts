import { db } from "@/lib/db";

export type MissingAthleteField = "birthDate" | "cpf" | "phone";

export async function getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { birthDate: true, cpf: true, phone: true },
  });

  const missing: MissingAthleteField[] = [];
  if (!profile?.birthDate) missing.push("birthDate");
  if (!profile?.cpf) missing.push("cpf");
  if (!profile?.phone) missing.push("phone");
  return missing;
}

export type SuggestedAthleteField = "gender" | "preferredShirtSize" | "city" | "state";

export async function getSuggestedAthleteProfileFields(userId: string): Promise<SuggestedAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { gender: true, preferredShirtSize: true, city: true, state: true },
  });

  const suggested: SuggestedAthleteField[] = [];
  if (!profile?.gender) suggested.push("gender");
  if (!profile?.preferredShirtSize) suggested.push("preferredShirtSize");
  if (!profile?.city) suggested.push("city");
  if (!profile?.state) suggested.push("state");
  return suggested;
}
