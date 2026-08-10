import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/categories/[categoryId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, categoryId: string) {
  return { params: Promise.resolve({ id, categoryId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/categories/cat-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/categories/cat-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/categories/[categoryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventCategory.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita categoria do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce({ id: "cat-1", eventId: "ev-1" });
    dbMock.eventCategory.update.mockResolvedValueOnce({ id: "cat-1", name: "M35" });

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("organizador titular do evento X é barrado com 404 ao tentar editar categoria de OUTRO evento (IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.eventCategory.update).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão edita a categoria", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce({ id: "cat-1", eventId: "ev-1" });
    dbMock.eventCategory.update.mockResolvedValueOnce({ id: "cat-1", name: "M35" });

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/categories/[categoryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventCategory.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui categoria do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce({ id: "cat-1", eventId: "ev-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));
    const body = await res.json();

    expect(dbMock.eventCategory.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
    expect(body).toEqual({ success: true });
  });

  it("organizador titular do evento X é barrado com 404 ao tentar excluir categoria de OUTRO evento (IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.eventCategory.delete).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão exclui a categoria", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.findFirst.mockResolvedValueOnce({ id: "cat-1", eventId: "ev-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(403);
  });
});
