import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/events/[id]/reject/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/events/event-1/reject", { method: "POST" }) as any;
}

describe("admin event reject api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.update.mockResolvedValue({ id: "event-1", status: "DRAFT" });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("ADMIN titular rejeita o evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { status: "DRAFT" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "admin-1", action: "EVENT_REJECTED" }) }),
    );
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN com events.reject concedido consegue rejeitar", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.assistantPermission.findFirst).toHaveBeenCalledWith({
      where: { userId: "assistant-1", actionKey: "events.reject" },
    });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.reject é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ORGANIZER titular é barrado com 403 (rota estritamente ADMIN)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
