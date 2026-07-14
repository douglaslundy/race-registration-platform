import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/admin/assistants/route";
import { PATCH as PATCH_BY_ID } from "@/app/api/admin/assistants/[id]/route";

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
