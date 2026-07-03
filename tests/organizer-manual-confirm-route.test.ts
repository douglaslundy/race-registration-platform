import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/manual-confirm/route";
import { notifyOrderConfirmed } from "@/lib/notifications";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/manual-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  status: "PENDING_PAYMENT",
  orderId: "order-1",
  order: { id: "order-1", payments: [{ id: "payment-1" }] },
};

describe("POST /api/organizer/registrations/[id]/manual-confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        payment: { update: vi.fn() },
        order: { update: vi.fn() },
        registration: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 400 com justificativa curta demais", async () => {
    const res = await POST(makeRequest({ reason: "ok" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição não está aguardando pagamento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...registrationFixture, status: "CONFIRMED" });
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há nenhum pagamento associado ao pedido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...registrationFixture, order: { id: "order-1", payments: [] } });
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("confirma a inscrição, o pagamento e o pedido, grava auditoria com o motivo, e notifica o atleta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);
    const txPaymentUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { update: txPaymentUpdate },
        order: { update: txOrderUpdate },
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(
      makeRequest({ reason: "Pagamento recebido via PIX manual, comprovante conferido" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "payment-1" }, data: expect.objectContaining({ status: "PAID" }) });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "PAID" } });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REGISTRATION_MANUALLY_CONFIRMED",
          metadata: { reason: "Pagamento recebido via PIX manual, comprovante conferido" },
        }),
      }),
    );
    expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1");
  });
});
