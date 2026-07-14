import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/events/[id]/approve/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/events/event-1/approve", { method: "POST" }) as any;
}

describe("admin event approve api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findUnique.mockResolvedValue({ id: "event-1", status: "UNDER_REVIEW" });
    dbMock.event.update.mockResolvedValue({ id: "event-1", status: "REGISTRATIONS_OPEN" });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("ADMIN titular aprova o evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: expect.objectContaining({ status: "REGISTRATIONS_OPEN" }),
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "admin-1", action: "EVENT_APPROVED" }) }),
    );
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o evento não existe", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-inexistente" }) });

    expect(res.status).toBe(404);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN com events.approve concedido consegue aprovar", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "events.approve" } },
    });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.approve é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

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
