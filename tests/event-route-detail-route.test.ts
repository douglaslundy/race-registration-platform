import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/routes/[routeId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, routeId: string) {
  return { params: Promise.resolve({ id, routeId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/routes/route-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/routes/route-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/routes/[routeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita percurso do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.update.mockResolvedValueOnce({ id: "route-1", name: "42km" });

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão edita o percurso", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.update.mockResolvedValueOnce({ id: "route-1", name: "42km" });

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/routes/[routeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui percurso do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));
    const body = await res.json();

    expect(dbMock.eventRoute.delete).toHaveBeenCalledWith({ where: { id: "route-1" } });
    expect(body).toEqual({ success: true });
  });

  it("assistente de organizador com a permissão exclui o percurso", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(403);
  });
});
