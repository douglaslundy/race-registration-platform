import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");

import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { PATCH } from "@/app/api/organizer/registrations/[id]/route";

const dbMock = db as any;
const checkPermMock = vi.mocked(checkApiPermission);
const resolveScope = vi.mocked(resolveActingScope);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const REG = {
  eventId: "event-1",
  participantName: "Nome Antigo",
  participantEmail: "antigo@exemplo.com",
  participantPhone: "11900000000",
  participantBirthDate: new Date("1990-01-01"),
  participantGender: "M",
  participantCpf: "11144477735",
  event: { organizerId: "org-1" },
};

describe("PATCH /api/organizer/registrations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({
      allowed: true,
      session: { user: { id: "organizer-1", role: "ORGANIZER" } },
    } as any);
    resolveScope.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" });
    dbMock.registration.findUnique.mockResolvedValue({ ...REG });
    dbMock.registration.update.mockResolvedValue({ id: "reg-1" });
    dbMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("retorna 404 quando o evento não pertence ao escopo do organizador", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-outro" });

    const res = await PATCH(makeRequest({ name: "Novo Nome" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(404);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
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
        userId: "organizer-1",
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

  it("birthDate: null e cpf: \"\" limpam os campos (viram null) e a auditoria registra a mudança", async () => {
    const res = await PATCH(makeRequest({ birthDate: null, cpf: "" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(200);
    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { participantBirthDate: null, participantCpf: null },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          before: { participantBirthDate: REG.participantBirthDate, participantCpf: "11144477735" },
          after: { participantBirthDate: null, participantCpf: null },
        },
      }),
    });
  });

  it("cpf: null limpa o participantCpf sem passar pela validação de CPF", async () => {
    const res = await PATCH(makeRequest({ cpf: null }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(200);
    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { participantCpf: null },
    });
  });

  it("assistente com registrations.edit-athlete no evento passa — checkApiPermission recebe { eventId }", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: true,
      session: { user: { id: "assistant-1", role: "ASSISTANT" } },
    } as any);
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });

    const res = await PATCH(makeRequest({ name: "Ajuste" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(200);
    expect(checkPermMock).toHaveBeenCalledWith("registrations.edit-athlete", { eventId: "event-1" });
  });

  it("propaga o 403 do checkApiPermission quando falta permissão", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: false,
      response: NextResponseJson({ error: "Não autorizado" }, 403),
    } as any);

    const res = await PATCH(makeRequest({ name: "Novo" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });

    expect(res.status).toBe(403);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });
});

function NextResponseJson(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
