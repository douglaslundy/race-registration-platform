import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/refund/route";
import { refundPayment } from "@/lib/payment/refund-service";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const registrationWithPayment = {
  id: "reg-1",
  order: { payments: [{ id: "pay-1" }] },
};

describe("POST /api/organizer/registrations/[id]/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), makeContext("reg-1"));
    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("organizador titular estorna o pagamento da própria inscrição", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest({ reason: "pedido do atleta" }), makeContext("reg-1"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizer: { userId: "org-user-1" } } },
      include: {
        order: {
          include: {
            payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 },
          },
        },
      },
    });
    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "org-user-1",
      reason: "pedido do atleta",
    });
    expect(res.status).toBe(200);
  });

  it("admin titular recebe 404 (SEM bypass — payments.refund não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("reg-9"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-9", event: { organizer: { userId: "admin-1" } } } })
    );
    expect(res.status).toBe(404);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão estorna usando o userId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest(), makeContext("reg-1"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizer: { userId: "org-user-1" } } } })
    );
    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "assistant-1",
      reason: undefined,
    });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("reg-1"));

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 400 quando refundPayment lança erro", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockRejectedValueOnce(new Error("Gateway indisponível"));

    const res = await POST(makeRequest(), makeContext("reg-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Gateway indisponível");
  });
});
