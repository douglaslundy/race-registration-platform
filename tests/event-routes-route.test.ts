import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/events/[id]/routes/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = { name: "21km", distanceKm: 21 };

describe("POST /api/events/[id]/routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria percurso no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.create.mockResolvedValueOnce({ id: "route-1", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("admin titular recebe 404 (SEM bypass — routes.create não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
  });

  it("assistente de organizador com a permissão cria percurso no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.create.mockResolvedValueOnce({ id: "route-2", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });
});
