import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/cancel-pending-manually", () => ({ cancelPendingPaymentManually: vi.fn() }));

import { POST } from "@/app/api/admin/registrations/[id]/cancel-pending/route";
import { cancelPendingPaymentManually } from "@/lib/payment/cancel-pending-manually";

const authMock = vi.mocked(auth);
const cancelPendingPaymentManuallyMock = vi.mocked(cancelPendingPaymentManually);
const dbMock = db as any;

const HOUR = 60 * 60 * 1000;

function makeRequest() {
  return new Request("http://localhost/api/admin/registrations/reg-1/cancel-pending", {
    method: "POST",
  }) as any;
}

function makeRegistration(overrides: Partial<{ status: string; createdAt: Date; payments: { id: string; status: string }[] }> = {}) {
  return {
    id: "reg-1",
    status: overrides.status ?? "PENDING_PAYMENT",
    createdAt: overrides.createdAt ?? new Date(Date.now() - 5 * HOUR),
    order: {
      id: "order-1",
      payments: overrides.payments ?? [{ id: "payment-1", status: "PENDING" }],
    },
  };
}

describe("POST /api/admin/registrations/[id]/cancel-pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não tem a permissão (inclusive organizador titular)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não existe", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(cancelPendingPaymentManuallyMock).not.toHaveBeenCalled();
  });

  it("busca a inscrição sem filtrar por organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelPendingPaymentManuallyMock.mockResolvedValueOnce({ ok: true });

    await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1" } }),
    );
  });

  it("retorna 400 quando a inscrição não está aguardando pagamento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration({ status: "CONFIRMED" }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelPendingPaymentManuallyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição pendente tem menos de 4h de criada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(
      makeRegistration({ createdAt: new Date(Date.now() - 1 * HOUR) }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelPendingPaymentManuallyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há nenhum pagamento associado ao pedido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration({ payments: [] }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelPendingPaymentManuallyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o último pagamento não está mais PENDING", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(
      makeRegistration({ payments: [{ id: "payment-1", status: "PAID" }] }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelPendingPaymentManuallyMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando cancelPendingPaymentManually não consegue cancelar (gateway recusou ou corrida — pagamento pago nesse ínterim)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelPendingPaymentManuallyMock.mockResolvedValueOnce({ ok: false, error: "Não foi possível cancelar" });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("cancela reaproveitando cancelPendingPaymentManually e grava auditoria com a ação correta de admin", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelPendingPaymentManuallyMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(cancelPendingPaymentManuallyMock).toHaveBeenCalledWith("payment-1");
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "REGISTRATION_MANUALLY_CANCELLED_BY_ADMIN",
        entityType: "Registration",
        entityId: "reg-1",
        metadata: { paymentId: "payment-1" },
      }),
    });
  });

  it("assistente de admin com a permissão cancela normalmente", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelPendingPaymentManuallyMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
