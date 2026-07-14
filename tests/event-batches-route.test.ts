import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/events/[id]/batches/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = {
  name: "Lote 1",
  priceAmount: 5000,
  capacity: 100,
  startAt: "2026-08-01T00:00:00.000Z",
  endAt: "2026-08-10T00:00:00.000Z",
};

describe("POST /api/events/[id]/batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não tem a permissão nem é titular", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria lote no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-1", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("organizador titular recebe 404 ao tentar criar lote em evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.ticketBatch.create).not.toHaveBeenCalled();
  });

  it("admin titular cria lote em qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-2", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it("assistente de organizador com a permissão cria lote no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-3", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(dbMock.event.findUnique).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão cria lote em qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-4", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(res.status).toBe(201);
  });
});
