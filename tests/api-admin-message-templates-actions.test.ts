import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({ checkAdminOnlyApiPermission: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import { POST as preview } from "@/app/api/admin/message-templates/[id]/preview/route";
import { POST as testSend } from "@/app/api/admin/message-templates/[id]/test-send/route";
import { POST as revert } from "@/app/api/admin/message-templates/[id]/revert/[versionId]/route";
import { sendMail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const dbMock = db as any;
const adminSession = { user: { id: "admin-1", role: "ADMIN" } };

function allow() {
  vi.mocked(checkAdminOnlyApiPermission).mockResolvedValue({ allowed: true, session: adminSession as any });
}

describe("POST .../preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renderiza com dados de exemplo e não envia nada", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
      subject: "Vagas em {{nome_evento}}", body: "{{nome_organizador}}, {{vagas_vendidas}}/{{capacidade_lote}}",
    });

    const res = await preview(new Request("http://localhost", { method: "POST" }) as any, { params: Promise.resolve({ id: "tpl-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.subject).not.toContain("{{");
    expect(data.body).not.toContain("{{");
    // Não basta não conter "{{" — precisa conter o valor de amostra real substituído,
    // senão uma variável rendendo como string vazia também passaria nessa checagem.
    expect(data.subject).toContain("Corrida Exemplo 5k");
    expect(data.body).toContain("João Organizador");
    expect(data.body).toContain("95/100");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("POST .../test-send", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignora qualquer destinatário enviado no body e usa sempre o e-mail/telefone da sessão", async () => {
    allow();
    dbMock.user.findUnique.mockResolvedValueOnce({ email: "admin-real@example.com", phone: "5511900000000", name: "Admin" });
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
      subject: "Assunto", body: "Corpo",
    });

    await testSend(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ to: "atacante@evil.com" }) }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin-real@example.com" }));
  });

  it("canal WHATSAPP usa sendWhatsAppMessage com o telefone do admin", async () => {
    allow();
    dbMock.user.findUnique.mockResolvedValueOnce({ email: "admin@example.com", phone: "5511900000000", name: "Admin" });
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-2", alertKey: "LOW_STOCK", channel: "WHATSAPP", recipientRole: "ORGANIZER", body: "Corpo",
    });

    await testSend(new Request("http://localhost", { method: "POST" }) as any, { params: Promise.resolve({ id: "tpl-2" }) });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511900000000", expect.any(String), "LOW_STOCK");
  });
});

describe("POST .../revert/[versionId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restaura o conteúdo da versão e grava o estado atual como novo histórico, incluindo rowTemplate", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", subject: "Atual", body: "Corpo atual", rowTemplate: "Linha atual", active: true });
    dbMock.messageTemplateVersion.findMany.mockResolvedValueOnce([
      { id: "ver-1", templateId: "tpl-1", subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga", active: true },
    ]);
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-1", subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga" });

    const res = await revert(new Request("http://localhost", { method: "POST" }) as any, { params: Promise.resolve({ id: "tpl-1", versionId: "ver-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", subject: "Atual", body: "Corpo atual", rowTemplate: "Linha atual", active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga", active: true, updatedByUserId: "admin-1" },
    });
  });

  it("404 quando a versão pedida não pertence a esse template", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", subject: "S", body: "B", active: true });
    dbMock.messageTemplateVersion.findMany.mockResolvedValueOnce([]);

    const res = await revert(new Request("http://localhost", { method: "POST" }) as any, { params: Promise.resolve({ id: "tpl-1", versionId: "ver-inexistente" }) });
    expect(res.status).toBe(404);
  });
});
