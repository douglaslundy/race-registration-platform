import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/expire-payments", () => ({ cancelExpiredPayment: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/cancel-pending/route";
import { cancelExpiredPayment } from "@/lib/payment/expire-payments";

const authMock = vi.mocked(auth);
const cancelExpiredPaymentMock = vi.mocked(cancelExpiredPayment);
const dbMock = db as any;

const HOUR = 60 * 60 * 1000;

function makeRequest() {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancel-pending", {
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

describe("POST /api/organizer/registrations/[id]/cancel-pending", () => {
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
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
  });

  it("escopa a busca da inscrição ao organizerId do organizador logado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelExpiredPaymentMock.mockResolvedValueOnce(true);

    await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "org-1" } } }),
    );
  });

  it("retorna 400 quando a inscrição não está aguardando pagamento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration({ status: "CONFIRMED" }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição pendente tem menos de 4h de criada — botão não deveria nem ter aparecido, mas a rota também barra", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(
      makeRegistration({ createdAt: new Date(Date.now() - 1 * HOUR) }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há nenhum pagamento associado ao pedido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration({ payments: [] }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o último pagamento não está mais PENDING", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(
      makeRegistration({ payments: [{ id: "payment-1", status: "PAID" }] }),
    );
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando cancelExpiredPayment não consegue cancelar (corrida — pagamento pago nesse ínterim)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelExpiredPaymentMock.mockResolvedValueOnce(false);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("cancela reaproveitando cancelExpiredPayment (mesma lógica do cron expire-payments) e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelExpiredPaymentMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(cancelExpiredPaymentMock).toHaveBeenCalledWith("payment-1");
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "REGISTRATION_MANUALLY_CANCELLED_BY_ORGANIZER",
        entityType: "Registration",
        entityId: "reg-1",
        metadata: { paymentId: "payment-1" },
      }),
    });
  });

  it("assistente de organizador com a permissão cancela a inscrição escopada ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(makeRegistration());
    cancelExpiredPaymentMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "org-1" } } }),
    );
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
