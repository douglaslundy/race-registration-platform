import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { POST } from "@/app/api/admin/payments/[id]/refund/route";
import { refundPayment } from "@/lib/payment/refund-service";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/admin/payments/pay-1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/payments/[id]/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), makeContext("pay-1"));
    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("admin titular estorna qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest({ reason: "fraude" }), makeContext("pay-1"));

    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "admin-1",
      reason: "fraude",
    });
    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão estorna qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(403);
  });

  it("retorna 400 quando refundPayment lança erro", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    refundPaymentMock.mockRejectedValueOnce(new Error("Pagamento já estornado"));

    const res = await POST(makeRequest(), makeContext("pay-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Pagamento já estornado");
  });
});
