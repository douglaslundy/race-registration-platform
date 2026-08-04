import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({ checkAdminOnlyApiPermission: vi.fn() }));

import { GET as listTemplates } from "@/app/api/admin/message-templates/route";
import { GET as getTemplate, PUT as putTemplate } from "@/app/api/admin/message-templates/[id]/route";

const dbMock = db as any;
const adminSession = { user: { id: "admin-1", role: "ADMIN" } };

function allow() {
  vi.mocked(checkAdminOnlyApiPermission).mockResolvedValue({ allowed: true, session: adminSession as any });
}
function deny() {
  const { NextResponse } = require("next/server");
  vi.mocked(checkAdminOnlyApiPermission).mockResolvedValue({
    allowed: false,
    response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }),
  });
}

describe("GET /api/admin/message-templates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia quem não é admin", async () => {
    deny();
    const res = await listTemplates(new Request("http://localhost/api/admin/message-templates") as any);
    expect(res.status).toBe(403);
  });

  it("lista todas as combinações do registry, com os dados salvos quando existem", async () => {
    allow();
    dbMock.messageTemplate.findMany.mockResolvedValueOnce([
      { id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "GLOBAL", eventId: null, active: true, updatedAt: new Date(), updatedByUserId: null },
    ]);

    const res = await listTemplates(new Request("http://localhost/api/admin/message-templates") as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.templates.some((t: any) => t.alertKey === "LOW_STOCK")).toBe(true);
  });
});

describe("PUT /api/admin/message-templates/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia quem não é admin", async () => {
    deny();
    const res = await putTemplate(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ body: "x" }) }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("rejeita variável desconhecida sem salvar nem gravar versão", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", subject: "S", body: "B", active: true,
    });

    const res = await putTemplate(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S", body: "{{hacker_var}}", active: true }) }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toContain("hacker_var");
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
    expect(dbMock.messageTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("salva com sucesso: grava a versão anterior antes de atualizar", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
      subject: "Assunto antigo", body: "Corpo antigo", active: true,
    });
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-1" });

    const res = await putTemplate(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "Novo {{nome_evento}}", body: "Novo corpo {{nome_organizador}}", active: true }) }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", subject: "Assunto antigo", body: "Corpo antigo", rowTemplate: undefined, active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { subject: "Novo {{nome_evento}}", body: "Novo corpo {{nome_organizador}}", rowTemplate: undefined, active: true, updatedByUserId: "admin-1" },
    });
  });

  it("rejeita variável desconhecida dentro do rowTemplate sem misturar com a lista de variáveis do body", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "RECONCILIATION_MISMATCH", channel: "EMAIL", recipientRole: "ADMIN",
      subject: "S", body: "B", rowTemplate: "R", active: true,
    });

    const res = await putTemplate(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ subject: "S", body: "B", rowTemplate: "{{campo_inventado}}", active: true }),
      }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toContain("campo_inventado");
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
  });

  it("salva rowTemplate com sucesso e grava a versão anterior (incluindo o rowTemplate antigo)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "RECONCILIATION_MISMATCH", channel: "EMAIL", recipientRole: "ADMIN",
      subject: "S antigo", body: "B antigo", rowTemplate: "R antigo", active: true,
    });
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-1" });

    const res = await putTemplate(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ subject: "S novo", body: "B novo", rowTemplate: "<tr><td>{{evento}}</td></tr>", active: true }),
      }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", subject: "S antigo", body: "B antigo", rowTemplate: "R antigo", active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { subject: "S novo", body: "B novo", rowTemplate: "<tr><td>{{evento}}</td></tr>", active: true, updatedByUserId: "admin-1" },
    });
  });

  it("404 quando o template não existe", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce(null);

    const res = await putTemplate(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ body: "x", active: true }) }) as any,
      { params: Promise.resolve({ id: "tpl-nao-existe" }) },
    );
    expect(res.status).toBe(404);
  });
});
