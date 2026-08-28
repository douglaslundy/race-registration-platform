import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/assistants/create-or-promote", () => ({ issueAssistantInvite: vi.fn() }));

import { GET } from "@/app/api/organizer/assistants/route";
import { PATCH as PATCH_BY_ID, DELETE as DELETE_BY_ID, PUT as PUT_BY_ID } from "@/app/api/organizer/assistants/[id]/route";
import { POST as RESEND } from "@/app/api/organizer/assistants/[id]/resend-invite/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/assistants/a1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/organizer/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lista apenas os assistentes criados pelo organizador com suas permissões", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
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
      expect.objectContaining({ where: { role: "ASSISTANT", createdByUserId: "org-1" } }),
    );
    expect(body.assistants[0]).toEqual(
      expect.objectContaining({ id: "a1", permissions: ["events.view", "events.approve"] }),
    );
  });
});

describe("PATCH /api/organizer/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(403);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o alvo não é um assistente", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ATHLETE" });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(404);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 404 ao tentar revogar um assistente de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-2" });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(404);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("revoga um assistente (active: false)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-1" });
    dbMock.user.update.mockResolvedValueOnce({ id: "a1", active: false });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    const body = await res.json();

    expect(dbMock.user.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { active: false } });
    expect(body).toEqual({ ok: true });
  });
});

describe("DELETE /api/organizer/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.assistantPermission.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.user.delete.mockResolvedValue({});
    dbMock.user.update.mockResolvedValue({});
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("403 para quem não é organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE_BY_ID(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(403);
  });

  it("exclui um assistente pendente do próprio organizador e audita", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER", name: "Org" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "p@x.com", passwordHash: null,
    });

    const res = await DELETE_BY_ID(new Request("http://x") as any, makeContext("a1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: "deleted" });
    expect(dbMock.user.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ASSISTANT_DELETED" }) }),
    );
  });

  it("404 ao excluir assistente de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER", name: "Org" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-2", email: "p@x.com", passwordHash: null,
    });
    const res = await DELETE_BY_ID(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(404);
    expect(dbMock.user.delete).not.toHaveBeenCalled();
  });
});

describe("PUT /api/organizer/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.assistantPermission.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.assistantPermission.createMany.mockResolvedValue({ count: 0 });
    dbMock.user.update.mockResolvedValue({});
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "profile-1" });
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  function makePutRequest(body: unknown) {
    return new Request("http://localhost/api/organizer/assistants/a1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any;
  }

  it("403 para quem não é organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PUT_BY_ID(makePutRequest({ name: "X", scopes: [] }), makeContext("a1"));
    expect(res.status).toBe(403);
  });

  it("400 quando o payload é inválido (nome vazio)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await PUT_BY_ID(makePutRequest({ name: "", scopes: [] }), makeContext("a1"));
    expect(res.status).toBe(400);
  });

  it("400 quando um eventId não pertence ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findMany.mockResolvedValueOnce([]); // nenhum evento casou
    const res = await PUT_BY_ID(
      makePutRequest({ name: "Maria", scopes: [{ eventId: "ev-de-outro", actionKeys: ["kits.deliver"] }] }),
      makeContext("a1"),
    );
    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("404 quando o assistente é de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-2", passwordHash: "h" });
    const res = await PUT_BY_ID(makePutRequest({ name: "Maria", scopes: [] }), makeContext("a1"));
    expect(res.status).toBe(404);
  });

  it("salva nome + escopos (evento próprio validado) e audita", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findMany.mockResolvedValueOnce([{ id: "ev-1" }]);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-1", passwordHash: "h" });

    const res = await PUT_BY_ID(
      makePutRequest({
        name: "Maria Silva",
        scopes: [
          { eventId: null, actionKeys: ["kits.view"] },
          { eventId: "ev-1", actionKeys: ["kits.deliver"] },
        ],
      }),
      makeContext("a1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(dbMock.event.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ev-1"] }, organizerId: "profile-1" },
      select: { id: true },
    });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "a1", actionKey: "kits.view", eventId: null },
        { userId: "a1", actionKey: "kits.deliver", eventId: "ev-1" },
      ],
      skipDuplicates: true,
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ASSISTANT_UPDATED" }) }),
    );
  });

  it("escopos só com eventId null não disparam validação de evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-1", passwordHash: "h" });

    const res = await PUT_BY_ID(
      makePutRequest({ name: "Maria", scopes: [{ eventId: null, actionKeys: ["events.view"] }] }),
      makeContext("a1"),
    );
    expect(res.status).toBe(200);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/organizer/assistants/[id]/resend-invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("reenvia convite para assistente pendente do próprio organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER", name: "Org" } } as any);
    dbMock.user.findUnique
      .mockResolvedValueOnce({ id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "p@x.com", passwordHash: null })
      .mockResolvedValueOnce({ name: "Maria" });

    const res = await RESEND(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ASSISTANT_INVITE_RESENT" }) }),
    );
  });

  it("400 se o assistente já concluiu o cadastro", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER", name: "Org" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "p@x.com", passwordHash: "hash",
    });
    const res = await RESEND(new Request("http://x") as any, makeContext("a1"));
    expect(res.status).toBe(400);
  });
});
