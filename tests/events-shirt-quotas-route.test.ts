import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/events/[id]/shirt-quotas/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePutRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/shirt-quotas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET/PUT /api/events/[id]/shirt-quotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET retorna 403 para quem não tem permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(new Request("http://localhost/api/events/ev-1/shirt-quotas") as any, makeContext("ev-1"));
    expect(res.status).toBe(403);
  });

  it("GET devolve os 6 tamanhos, com quantity null pra quem não tem quota configurada", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventShirtSizeQuota.findMany.mockResolvedValueOnce([{ size: "M", quantity: 50 }]);
    dbMock.registration.groupBy.mockResolvedValueOnce([{ shirtSize: "M", _count: { _all: 12 } }]);

    const res = await GET(new Request("http://localhost/api/events/ev-1/shirt-quotas") as any, makeContext("ev-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotas).toContainEqual({ size: "M", quantity: 50, usedCount: 12 });
    expect(body.quotas).toContainEqual({ size: "PP", quantity: null, usedCount: 0 });
    expect(body.quotas).toHaveLength(6);
  });

  it("PUT substitui as quotas do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventShirtSizeQuota.deleteMany.mockResolvedValueOnce({ count: 1 });
    dbMock.eventShirtSizeQuota.createMany.mockResolvedValueOnce({ count: 2 });
    dbMock.eventShirtSizeQuota.findMany.mockResolvedValueOnce([
      { size: "M", quantity: 50 },
      { size: "G", quantity: 0 },
    ]);
    dbMock.registration.groupBy.mockResolvedValueOnce([]);
    dbMock.$transaction.mockImplementationOnce(async (arg: any) => Promise.all(arg));

    const res = await PUT(
      makePutRequest({
        quotas: [
          { size: "PP", quantity: null },
          { size: "M", quantity: 50 },
          { size: "G", quantity: 0 },
        ],
      }),
      makeContext("ev-1"),
    );

    expect(dbMock.eventShirtSizeQuota.deleteMany).toHaveBeenCalledWith({ where: { eventId: "ev-1" } });
    expect(dbMock.eventShirtSizeQuota.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: "ev-1", size: "M", quantity: 50 },
        { eventId: "ev-1", size: "G", quantity: 0 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("PUT retorna 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PUT(makePutRequest({ quotas: [] }), makeContext("ev-2"));
    expect(res.status).toBe(404);
    expect(dbMock.eventShirtSizeQuota.deleteMany).not.toHaveBeenCalled();
  });
});
