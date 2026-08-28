import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/[id]/archive/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/archive", { method: "POST" }) as any;
}

describe("event archive api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.update.mockResolvedValue({ id: "event-1", status: "CANCELLED" });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("ORGANIZER titular arquiva o próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", status: "REGISTRATIONS_OPEN", organizerId: "org-1" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("ADMIN titular arquiva qualquer evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", status: "REGISTRATIONS_OPEN", organizerId: "org-9" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(res.status).toBe(200);
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o evento não existe/não pertence ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(404);
  });

  it("retorna 400 quando o evento já está arquivado/cancelado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", status: "CANCELLED", organizerId: "org-9" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por organizador com events.archive consegue arquivar evento do organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", status: "REGISTRATIONS_OPEN", organizerId: "org-1" });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.archive é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
