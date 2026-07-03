import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));
vi.mock("@/lib/alerts/reconciliation", () => ({ notifyReconciliationMismatches: vi.fn() }));

import { POST } from "@/app/api/organizer/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/organizer/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação escopada ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 2, mismatches: [] });

    await POST();

    expect(reconcilePayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
  });

  it("dispara o alerta para o admin quando encontra divergências", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const mismatches = [{ paymentId: "p1", orderId: "o1", eventTitle: "Corrida", localStatus: "PENDING", gatewayStatus: "PAID" }];
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 1, mismatches });

    await POST();

    expect(notifyReconciliationMismatches).toHaveBeenCalledWith(mismatches);
  });
});
