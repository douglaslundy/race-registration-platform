import { describe, it, expect, vi, beforeEach } from "vitest";
import { backfillRegistrationParticipants } from "@/prisma/backfill-registration-participants";

function makePrisma(pages: any[][]) {
  let call = 0;
  return {
    registration: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(pages[call++] ?? [])),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it("preenche participant* das linhas com participantName vazio, do athlete", async () => {
  const prisma = makePrisma([[
    { id: "r1", participantName: "", participantEmail: "",
      athlete: { name: "Maria", email: "m@x.com", athleteProfile: { phone: "11", birthDate: new Date("1990-01-01"), gender: "F", cpf: "12345678901" } } },
  ], []]);
  const res = await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).toHaveBeenCalledWith({
    where: { id: "r1" },
    data: { participantName: "Maria", participantEmail: "m@x.com", participantPhone: "11",
      participantBirthDate: new Date("1990-01-01"), participantGender: "F", participantCpf: "12345678901" },
  });
  expect(res).toEqual({ updated: 1 });
});

it("atleta sem AthleteProfile → só nome e email, resto null", async () => {
  const prisma = makePrisma([[
    { id: "r2", participantName: "", participantEmail: "",
      athlete: { name: "João", email: "j@x.com", athleteProfile: null } },
  ], []]);
  await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).toHaveBeenCalledWith({
    where: { id: "r2" },
    data: { participantName: "João", participantEmail: "j@x.com", participantPhone: null,
      participantBirthDate: null, participantGender: null, participantCpf: null },
  });
});

it("idempotente: linha já preenchida (participantName != '') não é buscada de novo", async () => {
  const prisma = makePrisma([[]]);  // findMany já filtra por participantName === ""
  const res = await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).not.toHaveBeenCalled();
  expect(res).toEqual({ updated: 0 });
});
