import { PrismaClient } from "@prisma/client";

const PAGE = 500;

export async function backfillRegistrationParticipants(
  prisma: Pick<PrismaClient, "registration">,
): Promise<{ updated: number }> {
  let cursor: string | undefined;
  let updated = 0;
  for (;;) {
    const rows = await prisma.registration.findMany({
      where: { participantName: "" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        athlete: {
          select: {
            name: true, email: true,
            athleteProfile: { select: { phone: true, birthDate: true, gender: true, cpf: true } },
          },
        },
      },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      await prisma.registration.update({
        where: { id: r.id },
        data: {
          participantName: r.athlete.name,
          participantEmail: r.athlete.email,
          participantPhone: r.athlete.athleteProfile?.phone ?? null,
          participantBirthDate: r.athlete.athleteProfile?.birthDate ?? null,
          participantGender: r.athlete.athleteProfile?.gender ?? null,
          participantCpf: r.athlete.athleteProfile?.cpf ?? null,
        },
      });
      updated++;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return { updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  backfillRegistrationParticipants(prisma)
    .then((r) => { console.log("[backfill-registration-participants]", r); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
