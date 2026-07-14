import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/organizer/registrations/[id]/athlete/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/athlete", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/organizer/registrations/[id]/athlete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        user: { update: vi.fn().mockResolvedValue({ id: "athlete-1", name: "Atleta", email: "atleta@exemplo.com" }) },
        athleteProfile: { upsert: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
  });

  it("retorna 403 para quem não é organizador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a evento do organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizerId: "org-1" } },
      }),
    );
  });

  it("rejeita CPF inválido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });

    const res = await PATCH(makeRequest({ cpf: "111.444.777-36" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outro atleta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PATCH(makeRequest({ cpf: "111.444.777-35" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(409);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita e-mail já usado por outra conta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "outro-user", email: "novo@exemplo.com" });

    const res = await PATCH(makeRequest({ email: "novo@exemplo.com" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(409);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("atualiza todos os campos do atleta e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);

    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "athlete-1",
      name: "Nome Corrigido",
      email: "corrigido@exemplo.com",
    });
    const txAthleteProfileUpsert = vi.fn().mockResolvedValueOnce({});
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: txAthleteProfileUpsert },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await PATCH(
      makeRequest({
        name: "Nome Corrigido",
        email: "corrigido@exemplo.com",
        cpf: "111.444.777-35",
        birthDate: "1990-01-01",
        phone: "11999998888",
        gender: "F",
        city: "São Paulo",
        state: "SP",
        teamName: "Equipe X",
        preferredShirtSize: "M",
      }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "athlete-1" },
        data: { name: "Nome Corrigido", email: "corrigido@exemplo.com" },
      }),
    );
    expect(txAthleteProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "athlete-1" },
        update: expect.objectContaining({
          cpf: "11144477735",
          birthDate: new Date("1990-01-01"),
          phone: "11999998888",
          gender: "F",
          city: "São Paulo",
          state: "SP",
          teamName: "Equipe X",
          preferredShirtSize: "M",
        }),
      }),
    );
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "organizer-1",
          action: "USER_UPDATED",
          entityType: "User",
          entityId: "athlete-1",
        }),
      }),
    );
  });

  it("rejeita e ignora tentativa de escalar privilégios (role, active, password)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);

    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "athlete-1",
      name: "Novo Nome",
      email: "atleta@exemplo.com",
    });
    const txAthleteProfileUpsert = vi.fn().mockResolvedValueOnce({});
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: txAthleteProfileUpsert },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await PATCH(
      makeRequest({
        name: "Novo Nome",
        role: "ADMIN",
        active: false,
        password: "hacked1234",
      }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    const callArgs = txUserUpdate.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty("role");
    expect(callArgs.data).not.toHaveProperty("active");
    expect(callArgs.data).not.toHaveProperty("password");
    expect(callArgs.data).not.toHaveProperty("passwordHash");
    expect(callArgs.data).toEqual({ name: "Novo Nome" });
  });

  it("retorna 404 para admin titular (sem acesso funcional a esta rota, mesmo passando a checagem de permissão)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "__none__" } } }),
    );
    expect(res.status).toBe(404);
  });

  it("assistente de organizador com a permissão edita o atleta escopado ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique
      .mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } })
      .mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });

    const res = await PATCH(makeRequest({ name: "Nome Ajustado" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ name: "Nome Ajustado" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
