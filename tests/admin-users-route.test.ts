import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/users/route";
import { GET as GETUserExport } from "@/app/api/admin/users/[id]/export/route";
import { DELETE, PATCH } from "@/app/api/admin/users/[id]/route";
import { PATCH as PATCHUserPreferences } from "@/app/api/me/preferences/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async () => "hashed-password"),
  },
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin users API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        auditLog: { updateMany: vi.fn() },
        user: { delete: vi.fn() },
      }),
    );
  });

  it("creates a user and writes an audit log", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.user.create.mockResolvedValueOnce({
      id: "user-1",
      name: "Novo Usuário",
      email: "novo@exemplo.com",
      role: "ATHLETE",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: "Novo Usuário",
          email: "novo@exemplo.com",
          password: "12345678",
          role: "ATHLETE",
          active: true,
        }),
      }) as any,
    );

    expect(res.status).toBe(201);
    expect((bcrypt as any).hash).toHaveBeenCalledWith("12345678", 12);
    expect(dbMock.user.create).toHaveBeenCalled();
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "USER_CREATED",
          entityType: "User",
          entityId: "user-1",
        }),
      }),
    );
  });

  it("exports filtered users as csv", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        name: "Ana Silva",
        email: "ana@exemplo.com",
        role: "ATHLETE",
        active: true,
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
        _count: { registrations: 3, orders: 1 },
      },
    ]);

    const res = await GET(
      new Request(
        "http://localhost/api/admin/users?format=csv&q=ana&role=ATHLETE&status=ACTIVE&createdFrom=2026-01-01&createdTo=2026-01-31&sort=name&dir=asc",
      ) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("usuarios.csv");
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ role: "ATHLETE" }),
            expect.objectContaining({ active: true }),
          ]),
        }),
        orderBy: expect.arrayContaining([expect.objectContaining({ name: "asc" })]),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"Ana Silva"');
    expect(csv).toContain('"ana@exemplo.com"');
    expect(csv).toContain('"ATHLETE"');
  });

  it("exports a user registration csv from the detail view", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      name: "Ana Silva",
      email: "ana@exemplo.com",
      registrations: [
        {
          event: { title: "Corrida das Pedras" },
          status: "CONFIRMED",
          order: { totalAmount: 15000, status: "PAID" },
          createdAt: new Date("2026-01-02T10:00:00.000Z"),
        },
      ],
    });

    const res = await GETUserExport(
      new Request("http://localhost/api/admin/users/user-1/export", { method: "GET" }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("usuario-user-1-inscricoes.csv");
    const csv = await res.text();
    expect(csv).toContain('"Ana Silva"');
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain('"CONFIRMED"');
  });

  it("updates the current user density preference", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCHUserPreferences(
      new Request("http://localhost/api/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({ uiDensity: "compact" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "admin-1" },
        data: { uiDensity: "compact" },
      }),
    );
  });

  it("updates a user and can change the password", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "old@exemplo.com",
    });
    dbMock.user.update.mockResolvedValueOnce({
      id: "user-1",
      name: "Usuário Atualizado",
      email: "novo@exemplo.com",
      role: "ADMIN",
      active: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Usuário Atualizado",
          email: "novo@exemplo.com",
          password: "87654321",
          role: "ADMIN",
          active: false,
        }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          name: "Usuário Atualizado",
          email: "novo@exemplo.com",
          role: "ADMIN",
          active: false,
          passwordHash: "hashed-password",
        }),
      }),
    );
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "USER_UPDATED",
          entityId: "user-1",
        }),
      }),
    );
  });

  it("corrige CPF e data de nascimento de um atleta", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });
    dbMock.user.update.mockResolvedValueOnce({
      id: "user-1",
      name: "Atleta",
      email: "atleta@exemplo.com",
      role: "ATHLETE",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({});

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-35", birthDate: "1990-01-01" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        update: expect.objectContaining({ cpf: "11144477735", birthDate: new Date("1990-01-01") }),
      }),
    );
  });

  it("rejeita CPF inválido na correção do admin", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-36" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outro atleta na correção do admin", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-35" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(409);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("prevents deleting users with linked orders or registrations", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      name: "Usuário",
      email: "user@exemplo.com",
    });
    dbMock.order.count.mockResolvedValueOnce(1);
    dbMock.registration.count.mockResolvedValueOnce(0);

    const res = await DELETE(
      new Request("http://localhost/api/admin/users/user-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(409);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("deletes a user with no linked records", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      name: "Usuário",
      email: "user@exemplo.com",
    });
    dbMock.order.count.mockResolvedValueOnce(0);
    dbMock.registration.count.mockResolvedValueOnce(0);

    const res = await DELETE(
      new Request("http://localhost/api/admin/users/user-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.$transaction).toHaveBeenCalled();
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "USER_DELETED",
          entityId: "user-1",
        }),
      }),
    );
  });
});
