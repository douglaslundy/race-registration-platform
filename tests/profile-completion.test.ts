import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getMissingAthleteProfileFields, getSuggestedAthleteProfileFields } from "@/lib/auth/profile-completion";

const dbMock = db as any;

const completeProfile = {
  birthDate: new Date("1990-01-01"),
  cpf: "11144477735",
  phone: "5511999999999",
  postalCode: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("getMissingAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando todos os campos obrigatórios estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(completeProfile);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });

  it("retorna todos os 9 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([
      "birthDate", "cpf", "phone", "postalCode", "street", "number", "neighborhood", "city", "state",
    ]);
  });

  it("retorna só cpf quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, cpf: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["cpf"]);
  });

  it("retorna só birthDate quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, birthDate: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate"]);
  });

  it("retorna só phone quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, phone: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["phone"]);
  });

  it("retorna só postalCode quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, postalCode: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["postalCode"]);
  });

  it("retorna só street quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, street: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["street"]);
  });

  it("retorna só number quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, number: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["number"]);
  });

  it("retorna só neighborhood quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, neighborhood: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["neighborhood"]);
  });

  it("retorna só city quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, city: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["city"]);
  });

  it("retorna só state quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, state: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["state"]);
  });

  it("nunca inclui complement na lista (campo opcional, fora do tipo MissingAthleteField)", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, complement: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });
});

describe("getSuggestedAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando gender e preferredShirtSize estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "M",
      preferredShirtSize: "M",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual([]);
  });

  it("retorna os 2 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["gender", "preferredShirtSize"]);
  });

  it("retorna só o campo vazio quando o perfil está parcialmente preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "F",
      preferredShirtSize: null,
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["preferredShirtSize"]);
  });
});
