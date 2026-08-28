import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({
  notifyPaymentError: vi.fn(),
  notifyOrderCancelledWithoutPayment: vi.fn(),
}));

import { POST } from "@/app/api/organizer/registrations/[id]/resend-payment-notification/route";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/organizer/registrations/reg-1/resend-payment-notification", {
    method: "POST",
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  order: { payments: [{ id: "payment-1" }] },
};

describe("POST /api/organizer/registrations/[id]/resend-payment-notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há pagamento expirado/cancelado para essa inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", order: { payments: [] } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("chama notifyPaymentError com bypassDedupe e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizerId: "org-1" } },
      }),
    );
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: "payment-1",
      }),
    });
  });

  it("chama notifyOrderCancelledWithoutPayment quando não há payment e a inscrição está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "CANCELLED",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(notifyOrderCancelledWithoutPayment).toHaveBeenCalledWith("order-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: "order-1",
      }),
    });
  });

  it("retorna 400 quando não há payment e a inscrição não está cancelada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      orderId: "order-1",
      order: { payments: [] },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(notifyOrderCancelledWithoutPayment).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão reenvia a notificação escopada ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
