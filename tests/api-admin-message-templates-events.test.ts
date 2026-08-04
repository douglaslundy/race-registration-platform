import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({ checkAdminOnlyApiPermission: vi.fn() }));
vi.mock("@/lib/templates/resolve", () => ({ getEffectiveTemplate: vi.fn() }));

import { GET, PUT, DELETE } from "@/app/api/admin/message-templates/[id]/eventos/[eventId]/route";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

const dbMock = db as any;
const adminSession = { user: { id: "admin-1", role: "ADMIN" } };

function allow() {
  vi.mocked(checkAdminOnlyApiPermission).mockResolvedValue({ allowed: true, session: adminSession as any });
}
function ctx(id: string, eventId: string) {
  return { params: Promise.resolve({ id, eventId }) };
}

describe("GET .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 quando o template global não existe", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    expect(res.status).toBe(404);
  });

  it("sem override de evento: retorna o conteúdo efetivo atual com isOverride: false", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
    });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({ subject: "Assunto global", body: "Corpo global", source: "global" });

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const data = await res.json();

    expect(getEffectiveTemplate).toHaveBeenCalledWith("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");
    expect(data.isOverride).toBe(false);
    expect(data.template.body).toBe("Corpo global");
    expect(data.template.id).toBeNull();
  });

  it("com override de evento já criado: retorna a linha salva com isOverride: true", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
    });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1", body: "Corpo customizado" });
    dbMock.messageTemplateVersion.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const data = await res.json();

    expect(data.isOverride).toBe(true);
    expect(data.template.body).toBe("Corpo customizado");
  });
});

describe("PUT .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria a linha EVENT quando ainda não existe (upsert)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);
    dbMock.messageTemplate.create.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S {{nome_evento}}", body: "B {{nome_organizador}}", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplate.create).toHaveBeenCalledWith({
      data: {
        alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "EVENT", eventId: "event-1",
        subject: "S {{nome_evento}}", body: "B {{nome_organizador}}", rowTemplate: undefined, active: true, updatedByUserId: "admin-1",
      },
    });
  });

  it("atualiza a linha EVENT quando já existe (grava versão antes)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1", subject: "S antigo", body: "B antigo", rowTemplate: null, active: true });
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S novo", body: "B novo", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-event-1", subject: "S antigo", body: "B antigo", rowTemplate: null, active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-event-1" },
      data: { subject: "S novo", body: "B novo", rowTemplate: undefined, active: true, updatedByUserId: "admin-1" },
    });
  });

  it("rejeita variável desconhecida sem criar nem atualizar nada", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S", body: "{{hacker_var}}", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(400);
    expect(dbMock.messageTemplate.create).not.toHaveBeenCalled();
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
  });

  it("404 quando o evento não existe", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce(null);

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ body: "B", active: true }) }) as any,
      ctx("tpl-1", "event-inexistente"),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 quando não existe personalização pra remover", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    expect(res.status).toBe(404);
    expect(dbMock.messageTemplate.delete).not.toHaveBeenCalled();
  });

  it("apaga a linha EVENT de vez (não marca active: false)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await DELETE(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const body = await res.json();

    expect(dbMock.messageTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl-event-1" } });
    expect(body).toEqual({ success: true });
  });
});
