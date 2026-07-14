import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/batches/[batchId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, batchId: string) {
  return { params: Promise.resolve({ id, batchId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/batches/batch-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/batches/batch-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/batches/[batchId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita lote do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.update.mockResolvedValueOnce({ id: "batch-1", name: "Novo nome" });

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("admin titular recebe 404 ao tentar editar lote de qualquer evento (SEM bypass — batches.edit não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-9", "batch-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão edita o lote", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.update.mockResolvedValueOnce({ id: "batch-1", name: "Novo nome" });

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/batches/[batchId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui lote do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));
    const body = await res.json();

    expect(dbMock.ticketBatch.delete).toHaveBeenCalledWith({ where: { id: "batch-1" } });
    expect(body).toEqual({ success: true });
  });

  it("assistente de organizador com a permissão exclui o lote", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(403);
  });
});
