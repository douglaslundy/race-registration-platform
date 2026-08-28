import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/events/[id]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/s3";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/s3", () => ({
  deleteObject: vi.fn(),
}));

const authMock = vi.mocked(auth);
const deleteObjectMock = vi.mocked(deleteObject);
const dbMock = db as any;

describe("event delete api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({
      id: "org-1",
      userId: "user-1",
    });
    dbMock.event.findFirst.mockResolvedValue({
      id: "event-1",
      status: "DRAFT",
      organizerId: "org-1",
    });
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.order.count.mockResolvedValue(0);
    dbMock.transferPayout.count.mockResolvedValue(0);
    dbMock.resultImport.count.mockResolvedValue(0);
    dbMock.fileAsset.findMany.mockResolvedValue([]);
    dbMock.event.delete.mockResolvedValue({ id: "event-1" });
    dbMock.fileAsset.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("deletes a draft event with no dependent data", async () => {
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        fileAsset: { deleteMany: dbMock.fileAsset.deleteMany },
        event: { delete: dbMock.event.delete },
        auditLog: { create: dbMock.auditLog.create },
      }),
    );

    const res = await DELETE(
      new Request("http://localhost/api/events/event-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.event.delete).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("blocks deletion when the event has registrations", async () => {
    dbMock.registration.count.mockResolvedValue(1);

    const res = await DELETE(
      new Request("http://localhost/api/events/event-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(409);
    expect(dbMock.event.delete).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por organizador com events.delete consegue excluir evento do organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        fileAsset: { deleteMany: dbMock.fileAsset.deleteMany },
        event: { delete: dbMock.event.delete },
        auditLog: { create: dbMock.auditLog.create },
      }),
    );

    const res = await DELETE(
      new Request("http://localhost/api/events/event-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
    expect(dbMock.event.delete).toHaveBeenCalledWith({ where: { id: "event-1" } });
  });

  it("ASSISTANT sem events.delete é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(
      new Request("http://localhost/api/events/event-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.event.delete).not.toHaveBeenCalled();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await DELETE(
      new Request("http://localhost/api/events/event-1", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(401);
  });
});
