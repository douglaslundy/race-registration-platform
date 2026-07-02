import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/organizer/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador (fronteira de segurança)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } } }),
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição não está com solicitação pendente (evita decremento duplo)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("APPROVE cancela a inscrição, o pedido e decrementa soldCount uma única vez", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLATION_REQUESTED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledTimes(1);
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_APPROVED" }) }),
    );
  });

  it("REJECT volta a inscrição para CONFIRMED sem tocar em Order ou soldCount", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLATION_REQUESTED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REJECTED" }) }),
    );
  });
});
