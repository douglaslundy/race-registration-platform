import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/events/[id]/coupons/report-export/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons/report-export") as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/events/[id]/coupons/report-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("organizador titular exporta relatório do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", title: "Corrida X", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "ev-1", organizerId: "org-1" },
      select: { id: true, title: true },
    });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular exporta relatório de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", title: "Corrida Y", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" }, select: { id: true, title: true } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão exporta", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", title: "Corrida X", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });

  it("assistente de admin com a permissão exporta de qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", title: "Corrida Y", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-9"));

    expect(res.status).toBe(200);
  });
});
