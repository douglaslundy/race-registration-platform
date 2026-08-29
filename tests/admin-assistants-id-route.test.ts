import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/assistants/create-or-promote", () => ({ issueAssistantInvite: vi.fn() }));

import { GET } from "@/app/api/admin/assistants/route";
import { PATCH as PATCH_BY_ID, DELETE as DELETE_BY_ID, PUT as PUT_BY_ID } from "@/app/api/admin/assistants/[id]/route";
import { POST as RESEND } from "@/app/api/admin/assistants/[id]/resend-invite/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/assistants/a1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/admin/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lista todos os assistentes da plataforma com suas permissões", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "a1",
        name: "Maria",
        email: "maria@example.com",
        active: true,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
        assistantPermissions: [{ actionKey: "events.view" }, { actionKey: "events.approve" }],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ASSISTANT" } }),
    );
    expect(body.assistants[0]).toEqual(
      expect.objectContaining({ id: "a1", permissions: ["events.view", "events.approve"] }),
    );
  });
});

describe("PATCH /api/admin/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(403);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o alvo não é um assistente", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ATHLETE" });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(404);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("revoga um assistente (active: false)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT" });
    dbMock.user.update.mockResolvedValueOnce({ id: "a1", active: false });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    const body = await res.json();

    expect(dbMock.user.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { active: false } });
    expect(body).toEqual({ ok: true });
  });
});

describe("DELETE /api/admin/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.assistantPermission.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.user.delete.mockResolvedValue({});
    dbMock.user.update.mockResolvedValue({});
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await DELETE_BY_ID(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(403);
  });

  it("rebaixa para ATHLETE um assistente que já concluiu o cadastro", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "a@x.com", passwordHash: "hash",
    });

    const res = await DELETE_BY_ID(new Request("http://x") as any, makeContext("a1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: "demoted" });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { role: "ATHLETE", createdByUserId: null },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ASSISTANT_DELETED" }) }),
    );
  });
});

describe("PUT /api/admin/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.assistantPermission.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.assistantPermission.createMany.mockResolvedValue({ count: 0 });
    dbMock.user.update.mockResolvedValue({});
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  function makePutRequest(body: unknown) {
    return new Request("http://localhost/api/admin/assistants/a1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any;
  }

  it("403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PUT_BY_ID(makePutRequest({ name: "X", actionKeys: [] }), makeContext("a1"));
    expect(res.status).toBe(403);
  });

  it("404 quando o alvo não é assistente", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ATHLETE" });
    const res = await PUT_BY_ID(makePutRequest({ name: "X", actionKeys: [] }), makeContext("a1"));
    expect(res.status).toBe(404);
  });

  it("edita qualquer assistente com escopo único sem evento (eventId null)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-9", passwordHash: "h",
    });

    const res = await PUT_BY_ID(
      makePutRequest({ name: "Novo Nome", actionKeys: ["events.view", "events.approve"] }),
      makeContext("a1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(dbMock.user.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { name: "Novo Nome" } });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "a1", actionKey: "events.view", eventId: null },
        { userId: "a1", actionKey: "events.approve", eventId: null },
      ],
      skipDuplicates: true,
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ASSISTANT_UPDATED" }) }),
    );
  });
});

describe("POST /api/admin/assistants/[id]/resend-invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("reenvia convite para assistente pendente (admin pode qualquer um)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    dbMock.user.findUnique
      .mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-9", email: "p@x.com", passwordHash: null })
      .mockResolvedValueOnce({ name: "Maria" });

    const res = await RESEND(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(200);
  });
});
