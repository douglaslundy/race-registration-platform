import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/admin/coupons/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = { code: "GLOBAL10", discountType: "PERCENT", discountValue: 10, eventId: null };

describe("POST /api/admin/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("admin titular cria cupom global", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c1", ...validBody });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
  });

  it("admin titular cria cupom de um evento específico", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c2", ...validBody, eventId: "ev-1" });

    const res = await POST(makeRequest({ ...validBody, eventId: "ev-1" }));

    expect(res.status).toBe(201);
  });

  it("assistente de admin com a permissão cria cupom global", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c3", ...validBody });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
  });

  it("assistente de organizador com a chave concedida por engano é barrado (não é assistente de admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(403);
  });
});
