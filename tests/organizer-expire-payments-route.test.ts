import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({ expirePendingPayments: vi.fn() }));

import { POST } from "@/app/api/organizer/expire-payments/route";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);

describe("POST /api/organizer/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
  });

  it("roda a expiração escopada ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });

    await POST();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
  });
});
