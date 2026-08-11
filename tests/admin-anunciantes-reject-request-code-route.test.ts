import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/reject/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(purchaseId: string) {
  return { params: Promise.resolve({ purchaseId }) };
}

describe("POST /api/admin/anunciantes/[purchaseId]/reject/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(404);
  });

  it("retorna 400 quando a compra não tem pagamento pago (nada a estornar, código não faz sentido)", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({ id: "purchase-1", status: "PENDING_APPROVAL", payments: [] });
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código pro pagamento da compra", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({ id: "purchase-1", status: "PENDING_APPROVAL", payments: [{ id: "payment-1" }] });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(body).toEqual({ verificationId: "code-1" });
  });
});
