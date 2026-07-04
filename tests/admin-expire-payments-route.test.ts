import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({ expirePendingPayments: vi.fn() }));

import { POST } from "@/app/api/admin/expire-payments/route";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);

describe("POST /api/admin/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
  });

  it("roda a expiração sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 5, expired: 3 });

    const res = await POST();
    const body = await res.json();

    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, expired: 3 });
  });
});
