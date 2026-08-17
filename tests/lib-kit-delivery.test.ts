import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRegistrationForKitDelivery, getKitDeliveryProgress } from "@/lib/kit-delivery";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("findRegistrationForKitDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna vazio pra query em branco, sem consultar o banco", async () => {
    const result = await findRegistrationForKitDelivery("event-1", "   ");
    expect(result).toEqual([]);
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
  });

  it("busca por id exato, peito exato, nome (contains) e CPF de 11 dígitos, só CONFIRMED", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await findRegistrationForKitDelivery("event-1", "123.456.789-00");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventId: "event-1",
          status: "CONFIRMED",
          OR: expect.arrayContaining([
            { id: "123.456.789-00" },
            { bibNumber: "123.456.789-00" },
            { athlete: { name: { contains: "123.456.789-00", mode: "insensitive" } } },
            { athlete: { athleteProfile: { cpf: "12345678900" } } },
          ]),
        }),
        take: 10,
      }),
    );
  });

  it("não inclui a cláusula de CPF quando a query não tem 11 dígitos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await findRegistrationForKitDelivery("event-1", "João");

    const call = dbMock.registration.findMany.mock.calls[0][0];
    const hasCpfClause = call.where.OR.some((clause: any) => clause.athlete?.athleteProfile?.cpf);
    expect(hasCpfClause).toBe(false);
  });

  it("mapeia inscrição sem entrega ainda", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        proxyAthleteDisplayName: null,
        bibNumber: "42",
        shirtSize: "M",
        status: "CONFIRMED",
        athlete: { name: "João Silva" },
        category: { name: "Geral" },
        kitDelivery: null,
      },
    ]);

    const result = await findRegistrationForKitDelivery("event-1", "João");

    expect(result).toEqual([
      {
        id: "reg-1",
        athleteName: "João Silva",
        bibNumber: "42",
        shirtSize: "M",
        categoryName: "Geral",
        status: "CONFIRMED",
        delivered: false,
        deliveredAt: null,
        deliveredByName: null,
        receivedByName: null,
      },
    ]);
  });

  it("mapeia inscrição já entregue, usando proxyAthleteDisplayName quando presente", async () => {
    const deliveredAt = new Date("2026-08-20T10:00:00.000Z");
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-2",
        proxyAthleteDisplayName: "Maria (procuração)",
        bibNumber: null,
        shirtSize: null,
        status: "CONFIRMED",
        athlete: { name: "Nome da conta" },
        category: null,
        kitDelivery: {
          deliveredAt,
          receivedByName: "Pedro (amigo)",
          deliveredBy: { name: "Organizador Um" },
        },
      },
    ]);

    const result = await findRegistrationForKitDelivery("event-1", "Maria");

    expect(result[0]).toEqual(
      expect.objectContaining({
        athleteName: "Maria (procuração)",
        delivered: true,
        deliveredAt,
        deliveredByName: "Organizador Um",
        receivedByName: "Pedro (amigo)",
      }),
    );
  });
});

describe("getKitDeliveryProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta entregues/pendentes e lista só os pendentes", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        proxyAthleteDisplayName: null,
        bibNumber: "1",
        athlete: { name: "Atleta A", email: "a@example.com", athleteProfile: { phone: "11999990000" } },
        category: { name: "Geral" },
        kitDelivery: { id: "kd-1" },
      },
      {
        id: "reg-2",
        proxyAthleteDisplayName: null,
        bibNumber: "2",
        athlete: { name: "Atleta B", email: "b@example.com", athleteProfile: null },
        category: null,
        kitDelivery: null,
      },
    ]);

    const result = await getKitDeliveryProgress("event-1");

    expect(result).toEqual({
      total: 2,
      delivered: 1,
      pending: [
        {
          id: "reg-2",
          athleteName: "Atleta B",
          bibNumber: "2",
          categoryName: null,
          email: "b@example.com",
          phone: null,
        },
      ],
    });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "CONFIRMED" } }),
    );
  });
});
