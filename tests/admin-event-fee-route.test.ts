import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/events/[id]/fee/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/events/event-1/fee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("admin event fee api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.update.mockResolvedValue({ id: "event-1", platformFeePercent: 500 });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("ADMIN titular atualiza a taxa da plataforma", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ platformFeePercent: 500 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { platformFeePercent: 500 },
    });
  });

  it("retorna 400 para payload inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ platformFeePercent: -1 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await PATCH(makeRequest({ platformFeePercent: 500 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN com events.set-fee concedido consegue atualizar a taxa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });

    const res = await PATCH(makeRequest({ platformFeePercent: 500 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "events.set-fee" } },
    });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.set-fee é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ platformFeePercent: 500 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ORGANIZER titular é barrado com 403 (rota estritamente ADMIN)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await PATCH(makeRequest({ platformFeePercent: 500 }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
