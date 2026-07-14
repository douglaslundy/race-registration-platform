import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/assistants/create-or-promote", () => ({
  createOrPromoteAssistant: vi.fn(),
}));

import { POST } from "@/app/api/admin/assistants/route";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(createOrPromoteAssistant);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/assistants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ email: "x@example.com", name: "X", actionKeys: ["events.approve"] }));
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o e-mail é inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    const res = await POST(makeRequest({ email: "não-é-email", name: "X", actionKeys: [] }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cria o assistente com as permissões informadas", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin Principal" } } as any);
    createMock.mockResolvedValueOnce({ ok: true, userId: "new-1", isNew: true });

    const res = await POST(makeRequest({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.approve", "events.view"],
    }));
    const body = await res.json();

    expect(createMock).toHaveBeenCalledWith({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.approve", "events.view"],
      createdByUserId: "admin-1",
      invitedByName: "Admin Principal",
    });
    expect(res.status).toBe(201);
    expect(body).toEqual({ userId: "new-1", isNew: true });
  });

  it("repassa o erro quando a criação/promoção falha", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    createMock.mockResolvedValueOnce({ ok: false, error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.", status: 400 });

    const res = await POST(makeRequest({ email: "existente@example.com", name: "X", actionKeys: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Este e-mail já pertence a uma conta titular e não pode virar assistente." });
  });
});
