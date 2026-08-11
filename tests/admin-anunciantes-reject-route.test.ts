import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestRejectedEmail: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/reject/route";
import { refundPayment } from "@/lib/payment/refund-service";
import { sendAdvertiserRequestRejectedEmail } from "@/lib/email";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/anunciantes/purchase-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/anunciantes/[purchaseId]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyCodeMock.mockResolvedValue({ ok: true });
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ reason: "motivo" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 sem motivo", async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ reason: "Dados inconsistentes" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(404);
  });

  it("rejeita: marca REJECTED com motivo, estorna o pagamento e envia e-mail", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });

    const res = await POST(
      makeRequest({ reason: "Dados inconsistentes", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ purchaseId: "purchase-1" }) },
    );

    expect(dbMock.adPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: { status: "REJECTED", rejectionReason: "Dados inconsistentes" },
    });
    expect(refundPayment).toHaveBeenCalledWith({ paymentId: "payment-1", initiatedByUserId: "admin-1", reason: "Dados inconsistentes" });
    expect(sendAdvertiserRequestRejectedEmail).toHaveBeenCalledWith({
      to: "fulano@example.com",
      name: "Fulano",
      reason: "Dados inconsistentes",
      refunded: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, refundFailed: false });
  });

  it("rejeita mesmo quando o estorno falha, mas sinaliza refundFailed e não afirma no e-mail que houve estorno", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });
    vi.mocked(refundPayment).mockRejectedValueOnce(new Error("gateway indisponível"));

    const res = await POST(
      makeRequest({ reason: "Dados inconsistentes", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ purchaseId: "purchase-1" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, refundFailed: true });
    expect(sendAdvertiserRequestRejectedEmail).toHaveBeenCalledWith({
      to: "fulano@example.com",
      name: "Fulano",
      reason: "Dados inconsistentes",
      refunded: false,
    });
  });

  it("retorna 400 sem verificationId/code", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });

    const res = await POST(makeRequest({ reason: "Dados inconsistentes" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.update).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o código é inválido, sem marcar REJECTED", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });
    vi.mocked(verifySensitiveActionCode).mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 2 });

    const res = await POST(
      makeRequest({ reason: "Dados inconsistentes", verificationId: "code-1", code: "000000" }),
      { params: Promise.resolve({ purchaseId: "purchase-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.update).not.toHaveBeenCalled();
  });
});
