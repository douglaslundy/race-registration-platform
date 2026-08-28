import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/assistants/create-or-promote", () => ({
  createOrPromoteAssistant: vi.fn(),
}));

import { POST } from "@/app/api/organizer/assistants/route";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(createOrPromoteAssistant);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/assistants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER", name: "Organizador Principal" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "profile-1" });
  });

  it("retorna 403 para quem não é organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ email: "x@example.com", name: "X", actionKeys: ["events.approve"], eventId: "ALL" }));
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o e-mail é inválido", async () => {
    const res = await POST(makeRequest({ email: "não-é-email", name: "X", actionKeys: [], eventId: "ALL" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o eventId está ausente", async () => {
    const res = await POST(makeRequest({ email: "maria@example.com", name: "Maria", actionKeys: [] }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o evento não pertence ao organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["kits.deliver"],
      eventId: "evento-de-outro",
    }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "evento-de-outro", organizerId: "profile-1" },
      select: { id: true },
    });
  });

  it("cria com escopo 'ALL' → grava eventId null", async () => {
    createMock.mockResolvedValueOnce({ ok: true, userId: "new-1", isNew: true });
    const res = await POST(makeRequest({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.view"],
      eventId: "ALL",
    }));
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.view"],
      createdByUserId: "org-1",
      invitedByName: "Organizador Principal",
      eventId: null,
    });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
  });

  it("cria com escopo de um evento próprio", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-7" });
    createMock.mockResolvedValueOnce({ ok: true, userId: "new-2", isNew: false });
    const res = await POST(makeRequest({
      email: "joao@example.com",
      name: "João",
      actionKeys: ["kits.deliver"],
      eventId: "event-7",
    }));
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-7" }));
  });

  it("repassa o erro quando a criação/promoção falha", async () => {
    createMock.mockResolvedValueOnce({ ok: false, error: "Este e-mail já é assistente de outro responsável.", status: 400 });
    const res = await POST(makeRequest({
      email: "existente@example.com",
      name: "X",
      actionKeys: [],
      eventId: "ALL",
    }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Este e-mail já é assistente de outro responsável." });
  });
});
