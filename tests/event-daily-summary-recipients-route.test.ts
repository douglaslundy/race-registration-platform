import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/daily-summary-recipients/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1/daily-summary-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/events/[id]/daily-summary-recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));
    expect(res.status).toBe(401);
  });

  it("retorna 404 quando o evento não existe ou não pertence ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizer: { userId: "org-1" } },
      select: { id: true, organizer: { select: { userId: true } } },
    });
    expect(res.status).toBe(404);
  });

  it("admin acessa qualquer evento, sem filtro de organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1" },
      select: { id: true, organizer: { select: { userId: true } } },
    });
    expect(res.status).toBe(200);
  });

  it("lista os contatos cadastrados pra esse evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
    ]);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true, value: true },
    });
    expect(body).toEqual({ recipients: [{ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" }] });
  });
});

describe("POST /api/events/[id]/daily-summary-recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 400 quando o e-mail é inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });

    const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "não-é-email" }), makeContext("event-1"));
    expect(res.status).toBe(400);
    expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
  });

  it("cria o contato com userId apontando pro organizador dono do evento, mesmo quando é o admin quem cadastra", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-owner-1" } });
    dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" });

    const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }), makeContext("event-1"));

    expect(res.status).toBe(201);
    expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
      data: { userId: "org-owner-1", eventId: "event-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      select: { id: true, name: true, type: true, value: true },
    });
  });
});
