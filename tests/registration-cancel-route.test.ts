import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import { POST } from "@/app/api/registrations/[id]/cancel/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getCancellationPolicyEnabled: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyCancellationRequested: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);
const policyMock = vi.mocked(getCancellationPolicyEnabled);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/registrations/reg-1/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const baseRegistration = {
  id: "reg-1",
  status: "CONFIRMED",
  ticketBatchId: "tb-1",
  event: {
    startAt: new Date("2099-01-01"),
    title: "Corrida Teste",
    cancellationDeadline: null as Date | null,
    cancellationRequiresApproval: false,
    cancellationContactEmail: null as string | null,
  },
  order: { id: "ord-1", status: "PAID" },
};

describe("POST /api/registrations/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
  });

  it("cancela imediatamente quando o interruptor global está desligado (comportamento atual preservado)", async () => {
    policyMock.mockResolvedValue(false);
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
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

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLED" }) }),
    );
  });

  it("bloqueia quando o interruptor está ligado e o prazo do evento já passou", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationDeadline: new Date("2020-01-01") },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Prazo de cancelamento encerrado");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("exige justificativa quando o evento requer aprovação e nenhuma foi enviada", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationRequiresApproval: true },
    });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Justificativa obrigatória para solicitar o cancelamento");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("vira solicitação (sem tocar em Order/soldCount) quando o evento requer aprovação e a justificativa foi enviada", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationRequiresApproval: true, cancellationContactEmail: "org@example.com" },
    });
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ reason: "Contusão no joelho" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("CANCELLATION_REQUESTED");
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: expect.objectContaining({ status: "CANCELLATION_REQUESTED", cancellationReason: "Contusão no joelho" }),
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REQUESTED" }) }),
    );
  });

  it("retorna 404 quando a inscrição não pertence ao atleta autenticado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
