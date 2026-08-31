import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { PATCH } from "@/app/api/athlete/registrations/[id]/route";

const dbMock = db as any;
const authMock = vi.mocked(auth as any);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/athlete/registrations/reg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const REG = {
  athleteUserId: "athlete-1",
  participantName: "Nome Antigo",
  participantEmail: "antigo@exemplo.com",
  participantPhone: "11900000000",
  participantBirthDate: new Date("1990-01-01"),
  participantGender: "M",
  participantCpf: "11144477735",
  shirtSize: "M",
  teamName: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
};

describe("PATCH /api/athlete/registrations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1" } });
    dbMock.registration.findUnique.mockResolvedValue({
      ...REG,
      event: { registrationEditDeadline: FUTURE },
    });
    dbMock.registration.update.mockResolvedValue({ id: "reg-1" });
    dbMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("retorna 401 quando não há sessão", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });
    expect(res.status).toBe(401);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("retorna 404 para inscrição de outro atleta", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      athleteUserId: "outro-atleta",
      event: { registrationEditDeadline: FUTURE },
    });
    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });
    expect(res.status).toBe(404);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não existe", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-999" }),
    });
    expect(res.status).toBe(404);
  });

  it("retorna 403 quando registrationEditDeadline é null", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      event: { registrationEditDeadline: null },
    });
    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "A edição desta inscrição não está disponível." });
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("retorna 403 quando o prazo já passou", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      event: { registrationEditDeadline: PAST },
    });
    const res = await PATCH(makeRequest({ name: "X" }), {
      params: Promise.resolve({ id: "reg-1" }),
    });
    expect(res.status).toBe(403);
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

  it("prazo no futuro → atualiza os campos permitidos e grava auditoria com by:athlete", async () => {
    const res = await PATCH(
      makeRequest({ name: "Nome Novo", phone: "11988887777" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { participantName: "Nome Novo", participantPhone: "11988887777" },
    });

    expect(dbMock.user.update).not.toHaveBeenCalled();
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
    expect(dbMock.athleteProfile.create).not.toHaveBeenCalled();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "athlete-1",
        action: "REGISTRATION_PARTICIPANT_UPDATED",
        entityType: "Registration",
        entityId: "reg-1",
        metadata: expect.objectContaining({
          by: "athlete",
          before: { participantName: "Nome Antigo", participantPhone: "11900000000" },
          after: { participantName: "Nome Novo", participantPhone: "11988887777" },
        }),
      }),
    });
  });

  it("ignora email e cpf no corpo — não entram no data do update", async () => {
    const res = await PATCH(
      makeRequest({ name: "Nome Novo", email: "novo@exemplo.com", cpf: "52998224725" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    expect(res.status).toBe(200);
    const data = dbMock.registration.update.mock.calls[0][0].data;
    expect(data).toEqual({ participantName: "Nome Novo" });
    expect(data).not.toHaveProperty("participantEmail");
    expect(data).not.toHaveProperty("participantCpf");
  });

  it("birthDate: null limpa o participantBirthDate e registra a mudança na auditoria", async () => {
    const res = await PATCH(makeRequest({ birthDate: null }), {
      params: Promise.resolve({ id: "reg-1" }),
    });
    expect(res.status).toBe(200);
    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { participantBirthDate: null },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          by: "athlete",
          before: { participantBirthDate: REG.participantBirthDate },
          after: { participantBirthDate: null },
        }),
      }),
    });
  });

  it("shirtSize/teamName/emergencyContact* também são editáveis", async () => {
    const res = await PATCH(
      makeRequest({
        shirtSize: "G",
        teamName: "Equipe X",
        emergencyContactName: "Fulano",
        emergencyContactPhone: "11970000000",
      }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    expect(res.status).toBe(200);
    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: {
        shirtSize: "G",
        teamName: "Equipe X",
        emergencyContactName: "Fulano",
        emergencyContactPhone: "11970000000",
      },
    });
  });
});
