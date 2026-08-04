import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { seedMessageTemplatesFromRegistry, refreshUnmodifiedTemplatesFromRegistry } from "@/lib/templates/seed";

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

describe("refreshUnmodifiedTemplatesFromRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-sincroniza uma linha nunca editada (0 versões) cujo texto salvo diverge do texto de fábrica atual", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue({
      id: "tpl-1",
      subject: "Assunto antigo — {{nome_evento}}",
      body: "Corpo antigo",
    });
    dbMock.messageTemplateVersion.count.mockResolvedValue(0);
    dbMock.messageTemplate.update.mockResolvedValue({});

    const result = await refreshUnmodifiedTemplatesFromRegistry();

    expect(dbMock.messageTemplate.update).toHaveBeenCalled();
    expect(result.refreshed).toBeGreaterThan(0);
  });

  it("NÃO re-sincroniza uma linha que já tem pelo menos 1 versão salva (foi customizada pelo admin)", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue({
      id: "tpl-1",
      subject: "Assunto customizado pelo admin",
      body: "Corpo customizado pelo admin",
    });
    dbMock.messageTemplateVersion.count.mockResolvedValue(1);

    const result = await refreshUnmodifiedTemplatesFromRegistry();

    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("NÃO re-sincroniza (e não lança) quando ainda não existe nenhuma linha pra aquela combinação", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);

    const result = await expect(refreshUnmodifiedTemplatesFromRegistry()).resolves.toBeDefined();
    void result;

    expect(dbMock.messageTemplateVersion.count).not.toHaveBeenCalled();
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
  });

  it("NÃO chama update quando o conteúdo salvo já é idêntico ao texto de fábrica atual (no-op)", async () => {
    dbMock.messageTemplate.findFirst.mockImplementation(async ({ where }: any) => {
      const def = (await import("@/lib/templates/registry")).ALERT_REGISTRY[
        where.alertKey as keyof typeof import("@/lib/templates/registry").ALERT_REGISTRY
      ];
      const { subject, body } = def.factoryDefault(where.channel, where.recipientRole);
      return { id: `tpl-${where.alertKey}-${where.channel}-${where.recipientRole}`, subject: subject ?? null, body };
    });
    dbMock.messageTemplateVersion.count.mockResolvedValue(0);

    const result = await refreshUnmodifiedTemplatesFromRegistry();

    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(0);
  });
});
