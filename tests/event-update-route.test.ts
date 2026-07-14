import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/events/[id]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("event update api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.update.mockResolvedValue({ id: "event-1", title: "Novo título" });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("ORGANIZER titular edita o próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizerId: "org-1" });

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("ORGANIZER titular recebe 404 ao tentar editar evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-2" }) });

    expect(res.status).toBe(404);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ADMIN titular edita qualquer evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(res.status).toBe(200);
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("retorna 400 para payload inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ modality: "INVALID" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por organizador com events.edit consegue editar evento do organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizerId: "org-1" });

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT criado por admin consegue editar qualquer evento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.edit é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ title: "Novo título" }), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
