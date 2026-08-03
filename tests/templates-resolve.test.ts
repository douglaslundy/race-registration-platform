import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { getEffectiveTemplate } from "@/lib/templates/resolve";

const dbMock = db as any;

describe("getEffectiveTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usa o template de evento quando existe e está ativo", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: "Assunto do evento", body: "Corpo do evento",
    });

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");

    expect(result).toEqual({ subject: "Assunto do evento", body: "Corpo do evento", source: "event" });
    expect(dbMock.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "EVENT", eventId: "event-1", active: true },
      select: { subject: true, body: true },
    });
  });

  it("cai pro template global quando não há override de evento", async () => {
    dbMock.messageTemplate.findFirst
      .mockResolvedValueOnce(null) // busca por evento
      .mockResolvedValueOnce({ subject: "Assunto global", body: "Corpo global" }); // busca global

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");

    expect(result).toEqual({ subject: "Assunto global", body: "Corpo global", source: "global" });
  });

  it("cai pro texto de fábrica quando não há nem evento nem global", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER");

    expect(result.source).toBe("factory");
    expect(result.subject).toBe("Vagas se esgotando — {{nome_evento}}");
  });

  it("cai pro texto de fábrica quando a query lança erro (nunca bloqueia o envio)", async () => {
    dbMock.messageTemplate.findFirst.mockRejectedValue(new Error("timeout"));

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER");

    expect(result.source).toBe("factory");
  });

  it("sem eventId, não tenta buscar template de evento", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ subject: "S", body: "B" });

    await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER");

    expect(dbMock.messageTemplate.findFirst).toHaveBeenCalledTimes(1);
    expect(dbMock.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "GLOBAL", eventId: null, active: true },
      select: { subject: true, body: true },
    });
  });

  it("alertKey desconhecido no registry: sem linha no banco, lança internamente e é pega — retorna corpo vazio com source factory em vez de quebrar o chamador", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);

    const result = await getEffectiveTemplate("CHAVE_INEXISTENTE", "EMAIL", "ORGANIZER");

    expect(result).toEqual({ subject: undefined, body: "", source: "factory" });
  });
});
