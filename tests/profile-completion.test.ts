import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getMissingAthleteProfileFields, getSuggestedAthleteProfileFields } from "@/lib/auth/profile-completion";

const dbMock = db as any;

describe("getMissingAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando birthDate, cpf e phone estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: "11144477735",
      phone: "5511999999999",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });

  it("retorna birthDate, cpf e phone quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate", "cpf", "phone"]);
  });

  it("retorna só cpf quando birthDate e phone já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: null,
      phone: "5511999999999",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["cpf"]);
  });

  it("retorna só birthDate quando cpf e phone já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: null,
      cpf: "11144477735",
      phone: "5511999999999",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate"]);
  });

  it("retorna só phone quando birthDate e cpf já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: "11144477735",
      phone: null,
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["phone"]);
  });
});

describe("getSuggestedAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando gender, preferredShirtSize, city e state estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "M",
      preferredShirtSize: "M",
      city: "São Paulo",
      state: "SP",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual([]);
  });

  it("retorna os 4 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["gender", "preferredShirtSize", "city", "state"]);
  });

  it("retorna só os campos vazios quando o perfil está parcialmente preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "F",
      preferredShirtSize: null,
      city: null,
      state: "RJ",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["preferredShirtSize", "city"]);
  });
});
