import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  registration: { findMany: vi.fn() },
  raceResult: { findMany: vi.fn() },
  event: { findMany: vi.fn() },
  ratingEvent: { createMany: vi.fn(), aggregate: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { athleteProfileItems, organizerProfileItems, completionPercent, syncRating } from "@/lib/rating";

const fullRequired = {
  birthDate: new Date("1990-01-01"), cpf: "1", phone: "1", postalCode: "1", street: "r", number: "1",
  neighborhood: "b", city: "c", state: "MG",
};

describe("completude", () => {
  it("perfil vazio = 0%; só obrigatórios = 40/90 (44%); tudo + foto = 100%", () => {
    expect(completionPercent(athleteProfileItems(null, null))).toBe(0);
    expect(completionPercent(athleteProfileItems(fullRequired, null))).toBe(44);
    const all = { ...fullRequired, gender: "M", preferredShirtSize: "M", emergencyName: "a", emergencyPhone: "1", medicalNotes: "x", teamName: "t" };
    expect(completionPercent(athleteProfileItems(all, "http://a"))).toBe(100);
  });

  it("obrigatórios incompletos não pontuam o grupo; strings em branco não contam", () => {
    const items = athleteProfileItems({ ...fullRequired, city: "  " }, null);
    expect(items.find((i) => i.key === "profile:required")?.done).toBe(false);
  });

  it("organizador pontua por empresa/CNPJ/etc.", () => {
    const items = organizerProfileItems({ companyName: "X", cnpj: "1" }, null);
    expect(completionPercent(items)).toBe(Math.round((25 / 70) * 100));
  });
});

describe("syncRating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atleta: pontua cadastro, inscrição confirmada e resultado; grava idempotente e soma", async () => {
    dbMock.user.findUnique
      .mockResolvedValueOnce({ role: "ATHLETE" })
      .mockResolvedValueOnce({ avatarUrl: null, athleteProfile: fullRequired, organizerProfile: null });
    dbMock.registration.findMany.mockResolvedValue([{ id: "r1", eventId: "e1", bibNumber: "7" }, { id: "r2", eventId: "e2", bibNumber: null }]);
    dbMock.raceResult.findMany.mockResolvedValue([{ eventId: "e1", bibNumber: "7" }]);
    dbMock.ratingEvent.aggregate.mockResolvedValue({ _sum: { points: 100 } });

    expect(await syncRating("u1")).toBe(100);

    const data = dbMock.ratingEvent.createMany.mock.calls[0][0];
    expect(data.skipDuplicates).toBe(true);
    expect(Object.fromEntries(data.data.map((d: any) => [d.key, d.points]))).toEqual({
      "profile:required": 40, "reg:r1": 10, "reg:r2": 10, "result:r1": 20,
    });
    expect(dbMock.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { ratingPoints: 100 } });
  });

  it("organizador: pontua evento concluído", async () => {
    dbMock.user.findUnique
      .mockResolvedValueOnce({ role: "ORGANIZER" })
      .mockResolvedValueOnce({ avatarUrl: null, athleteProfile: null, organizerProfile: null });
    dbMock.event.findMany.mockResolvedValue([{ id: "e1" }]);
    dbMock.ratingEvent.aggregate.mockResolvedValue({ _sum: { points: 30 } });
    await syncRating("o1");
    expect(dbMock.ratingEvent.createMany.mock.calls[0][0].data).toEqual([{ userId: "o1", key: "event:e1", points: 30 }]);
  });

  it("usuário inexistente devolve 0 sem gravar", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    expect(await syncRating("x")).toBe(0);
    expect(dbMock.ratingEvent.createMany).not.toHaveBeenCalled();
  });
});
