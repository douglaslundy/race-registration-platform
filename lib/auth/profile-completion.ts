import { db } from "@/lib/db";

export type MissingAthleteField = "birthDate" | "cpf";

export async function getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { birthDate: true, cpf: true },
  });

  const missing: MissingAthleteField[] = [];
  if (!profile?.birthDate) missing.push("birthDate");
  if (!profile?.cpf) missing.push("cpf");
  return missing;
}
