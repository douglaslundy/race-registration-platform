import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";

const dbMock = db as any;

describe("getMissingAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando birthDate e cpf estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: "11144477735",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });

  it("retorna birthDate e cpf quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate", "cpf"]);
  });

  it("retorna só cpf quando birthDate já está preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: null,
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["cpf"]);
  });

  it("retorna só birthDate quando cpf já está preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: null,
      cpf: "11144477735",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate"]);
  });
});
