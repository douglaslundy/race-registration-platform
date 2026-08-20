import { db } from "@/lib/db";

export type MissingAthleteField =
  | "birthDate"
  | "cpf"
  | "phone"
  | "postalCode"
  | "street"
  | "number"
  | "neighborhood"
  | "city"
  | "state";

export async function getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: {
      birthDate: true,
      cpf: true,
      phone: true,
      postalCode: true,
      street: true,
      number: true,
      neighborhood: true,
      city: true,
      state: true,
    },
  });

  const missing: MissingAthleteField[] = [];
  if (!profile?.birthDate) missing.push("birthDate");
  if (!profile?.cpf) missing.push("cpf");
  if (!profile?.phone) missing.push("phone");
  if (!profile?.postalCode) missing.push("postalCode");
  if (!profile?.street) missing.push("street");
  if (!profile?.number) missing.push("number");
  if (!profile?.neighborhood) missing.push("neighborhood");
  if (!profile?.city) missing.push("city");
  if (!profile?.state) missing.push("state");
  return missing;
}

export type SuggestedAthleteField = "gender" | "preferredShirtSize";

export async function getSuggestedAthleteProfileFields(userId: string): Promise<SuggestedAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { gender: true, preferredShirtSize: true },
  });

  const suggested: SuggestedAthleteField[] = [];
  if (!profile?.gender) suggested.push("gender");
  if (!profile?.preferredShirtSize) suggested.push("preferredShirtSize");
  return suggested;
}
