import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));

import { POST } from "@/app/api/admin/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/admin/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();
    const body = await res.json();

    expect(reconcilePayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, mismatches: [] });
  });
});
