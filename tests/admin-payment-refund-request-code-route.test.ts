import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/admin/payments/[id]/refund/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/payments/[id]/refund/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 pra organizador titular", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(403);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o pagamento não está com status Pago", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PENDING" });
    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código e retorna o verificationId", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PAID" });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "pay-1" });
    expect(res.status).toBe(200);
    expect(body).toEqual({ verificationId: "code-1" });
  });

  it("retorna 400 quando o serviço de código falha (ex: rate limit)", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PAID" });
    requestCodeMock.mockResolvedValueOnce({ ok: false, error: "Muitos pedidos de código em pouco tempo." });

    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(400);
  });
});
