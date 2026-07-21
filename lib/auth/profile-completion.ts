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
