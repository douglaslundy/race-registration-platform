import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/admin/coupons/export/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/admin/coupons/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular exporta CSV de todos os cupons", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.groupBy.mockResolvedValueOnce([]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão exporta CSV", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.groupBy.mockResolvedValueOnce([]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(403);
  });
});
