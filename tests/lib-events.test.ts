import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listPublicEvents, listDistinctLocations } from "@/lib/events";

const dbMock = db as any;

describe("listPublicEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findMany.mockResolvedValue([]);
    dbMock.event.count.mockResolvedValue(0);
  });

  it("sem filtro de status, usa o conjunto ativa (comportamento atual) ordenado por startAt asc", async () => {
    await listPublicEvents({});

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
        }),
        orderBy: { startAt: "asc" },
      })
    );
  });

  it('status: "ativa" explícito usa o mesmo conjunto e ordenação que o padrão', async () => {
    await listPublicEvents({ status: "ativa" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
        }),
        orderBy: { startAt: "asc" },
      })
    );
  });

  it('status: "encerrada" filtra REGISTRATIONS_CLOSED/COMPLETED e ordena startAt desc', async () => {
    await listPublicEvents({ status: "encerrada" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["REGISTRATIONS_CLOSED", "COMPLETED"] },
        }),
        orderBy: { startAt: "desc" },
      })
    );
  });

  it("filtro de estado usa comparação exata case-insensitive, não contains", async () => {
    await listPublicEvents({ state: "sp" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { equals: "sp", mode: "insensitive" },
        }),
      })
    );
  });

  it("sem filtro de estado, não inclui a chave state no where", async () => {
    await listPublicEvents({});

    const call = dbMock.event.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty("state");
  });

  it("combina estado com cidade e modalidade sem conflito", async () => {
    await listPublicEvents({ state: "RJ", city: "Niterói", modality: "TRAIL_RUN" as any });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { equals: "RJ", mode: "insensitive" },
          city: { contains: "Niterói", mode: "insensitive" },
          modality: "TRAIL_RUN",
        }),
      })
    );
  });
});

describe("listDistinctLocations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findMany.mockResolvedValue([]);
  });

  it("busca cidades/estados cobrindo tanto status ativos quanto encerrados", async () => {
    await listDistinctLocations();

    expect(dbMock.event.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT", "REGISTRATIONS_CLOSED", "COMPLETED"],
        },
      },
      select: { city: true, state: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
    });
  });
});
