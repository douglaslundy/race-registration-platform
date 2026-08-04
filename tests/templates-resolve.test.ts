import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { getEffectiveTemplate } from "@/lib/templates/resolve";
import * as registry from "@/lib/templates/registry";

const dbMock = db as any;

describe("getEffectiveTemplate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("usa o template de evento quando existe e está ativo", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: "Assunto do evento", body: "Corpo do evento",
    });

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");

    expect(result).toEqual({ subject: "Assunto do evento", body: "Corpo do evento", source: "event" });
    expect(dbMock.messageTemplate.findFirst).toHaveBeenCalledWith({
      where: { alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "EVENT", eventId: "event-1", active: true },
      select: { subject: true, body: true, rowTemplate: true },
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
      select: { subject: true, body: true, rowTemplate: true },
    });
  });

  it("alertKey desconhecido no registry: sem linha no banco, lança internamente e é pega — retorna corpo vazio com source factory em vez de quebrar o chamador", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);

    const result = await getEffectiveTemplate("CHAVE_INEXISTENTE", "EMAIL", "ORGANIZER");

    expect(result).toEqual({ subject: undefined, body: "", source: "factory" });
  });

  it("quando getAlertDefinition lança erro (fallback mesmo falha), retorna safe default sem rejeitar", async () => {
    dbMock.messageTemplate.findFirst.mockRejectedValue(new Error("db down"));
    vi.spyOn(registry, "getAlertDefinition").mockImplementation(() => {
      throw new Error("registry corrupted");
    });

    const result = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER");

    expect(result).toEqual({ subject: undefined, body: "", source: "factory" });
  });

  it("quando o alertKey tem rowTemplate no registry e a linha do banco não tem um customizado, usa o de fábrica", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ subject: "S", body: "B", rowTemplate: null });

    const result = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");

    const factory = registry.ALERT_REGISTRY.RECONCILIATION_MISMATCH.rowTemplate!("EMAIL");
    expect(result.rowTemplate).toBe(factory);
  });

  it("quando a linha do banco já tem um rowTemplate customizado, usa ele em vez do de fábrica", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: "S", body: "B", rowTemplate: "<tr><td>{{evento}}</td></tr>",
    });

    const result = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");

    expect(result.rowTemplate).toBe("<tr><td>{{evento}}</td></tr>");
  });
});
