import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { seedMessageTemplatesFromRegistry } from "@/lib/templates/seed";

const dbMock = db as any;

describe("seedMessageTemplatesFromRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria uma linha global pra cada combinação alerta×canal×papel do registry que ainda não existe", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null); // nenhuma linha existe ainda
    dbMock.messageTemplate.create.mockResolvedValue({});

    const result = await seedMessageTemplatesFromRegistry();

    expect(dbMock.messageTemplate.create).toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
  });

  it("não cria de novo uma linha global que já existe (idempotente)", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue({ id: "existing" });

    const result = await seedMessageTemplatesFromRegistry();

    expect(dbMock.messageTemplate.create).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("uma linha criada usa o texto de fábrica exato do registry pra LOW_STOCK/EMAIL/ORGANIZER", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
    dbMock.messageTemplate.create.mockResolvedValue({});

    await seedMessageTemplatesFromRegistry();

    expect(dbMock.messageTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertKey: "LOW_STOCK",
        channel: "EMAIL",
        recipientRole: "ORGANIZER",
        scope: "GLOBAL",
        subject: "Vagas se esgotando — {{nome_evento}}",
        active: true,
      }),
    });
  });
});
