import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");

import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { PATCH } from "@/app/api/admin/registrations/[id]/route";

const dbMock = db as any;
const checkPermMock = vi.mocked(checkAdminOnlyApiPermission);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/registrations/reg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const REG = {
  participantName: "Nome Antigo",
  participantEmail: "antigo@exemplo.com",
  participantPhone: "11900000000",
  participantBirthDate: new Date("1990-01-01"),
  participantGender: "M",
  participantCpf: "11144477735",
};

describe("PATCH /api/admin/registrations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({
      allowed: true,
      session: { user: { id: "admin-1", role: "ADMIN" } },
    } as any);
    dbMock.registration.findUnique.mockResolvedValue({ ...REG });
    dbMock.registration.update.mockResolvedValue({ id: "reg-1" });
    dbMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("propaga o 403 quando não é admin nem assistente-de-admin", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: false,
      response: new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    } as any);

    const res = await PATCH(makeRequest({ name: "Novo" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(403);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("admin edita qualquer inscrição — sem checagem de organizerId", async () => {
    const res = await PATCH(makeRequest({ name: "Nome Corrigido" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(checkPermMock).toHaveBeenCalledWith("registrations.edit-athlete-any");
    // findUnique não seleciona event/organizerId
    const selectArg = dbMock.registration.findUnique.mock.calls[0][0].select;
    expect(selectArg.event).toBeUndefined();
  });

  it("retorna 400 para CPF inválido e não grava nada", async () => {
    const res = await PATCH(makeRequest({ cpf: "111.444.777-36" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 para e-mail inválido", async () => {
    const res = await PATCH(makeRequest({ email: "nao-e-email" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("retorna 400 para corpo vazio", async () => {
    const res = await PATCH(makeRequest({}), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("retorna 400 para data de nascimento inválida", async () => {
    const res = await PATCH(makeRequest({ birthDate: "data-ruim" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("atualiza só os campos participant* enviados e grava auditoria — nunca toca na conta", async () => {
    const res = await PATCH(
      makeRequest({ name: "Nome Corrigido", email: "Corrigido@Exemplo.com" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { participantName: "Nome Corrigido", participantEmail: "corrigido@exemplo.com" },
    });

    expect(dbMock.user.update).not.toHaveBeenCalled();
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
    expect(dbMock.athleteProfile.create).not.toHaveBeenCalled();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "REGISTRATION_PARTICIPANT_UPDATED",
        entityType: "Registration",
        entityId: "reg-1",
        metadata: {
          before: { participantName: "Nome Antigo", participantEmail: "antigo@exemplo.com" },
          after: { participantName: "Nome Corrigido", participantEmail: "corrigido@exemplo.com" },
        },
      }),
    });
  });

  it("assistente-de-admin com registrations.edit-athlete-any global → passa", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: true,
      session: { user: { id: "assistant-1", role: "ASSISTANT" } },
    } as any);

    const res = await PATCH(makeRequest({ name: "Ajuste" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(200);
    expect(checkPermMock).toHaveBeenCalledWith("registrations.edit-athlete-any");
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "assistant-1" }),
    });
  });

  it("retorna 404 quando a inscrição não existe", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-999" }),
    });

    expect(res.status).toBe(404);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });
});
