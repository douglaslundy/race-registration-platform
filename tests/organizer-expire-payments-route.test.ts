import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({
  expirePendingPayments: vi.fn(),
  expireAbandonedOrders: vi.fn(),
}));

import { POST } from "@/app/api/organizer/expire-payments/route";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("POST /api/organizer/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("roda os dois mecanismos escopados ao organizador e soma o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 1, expired: 0 });

    const res = await POST();
    const body = await res.json();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
    expect(expireAbandonedOrders).toHaveBeenCalledWith({ organizerUserId: "org-1" });
    expect(body).toEqual({ checked: 3, expired: 1 });
  });

  it("assistente de organizador com a permissão roda os mecanismos escopados ao userId do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 1, expired: 0 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 0, expired: 0 });

    const res = await POST();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-user-1" });
    expect(expireAbandonedOrders).toHaveBeenCalledWith({ organizerUserId: "org-user-1" });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
  });
});
