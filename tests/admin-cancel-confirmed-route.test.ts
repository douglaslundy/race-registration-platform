import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  cancelConfirmedRegistrationDirectly: vi.fn(),
}));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  requestSensitiveActionCode: vi.fn(),
  verifySensitiveActionCode: vi.fn(),
}));

import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { requestSensitiveActionCode, verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { cancelConfirmedRegistrationDirectly } from "@/lib/registrations/cancellation-decision-service";
import { POST as REQUEST_CODE } from "@/app/api/admin/registrations/[id]/cancel-confirmed/request-code/route";
import { POST as CONFIRM } from "@/app/api/admin/registrations/[id]/cancel-confirmed/route";

const dbMock = db as any;
const checkAdminMock = vi.mocked(checkAdminOnlyApiPermission);
const requestCodeMock = vi.mocked(requestSensitiveActionCode);
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);
const cancelMock = vi.mocked(cancelConfirmedRegistrationDirectly);

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/registrations/reg-1/cancel-confirmed", {
    method: "POST",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  }) as any;
}

describe("POST /api/admin/registrations/[id]/cancel-confirmed/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminMock.mockResolvedValue({ allowed: true, session: { user: { id: "admin-1", role: "ADMIN" } } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);

    const res = await REQUEST_CODE(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não existe (qualquer evento)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await REQUEST_CODE(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "reg-1" } }));
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição não está CONFIRMED", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ status: "CANCELLED" });

    const res = await REQUEST_CODE(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("solicita o código com o actionType correto", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ status: "CONFIRMED" });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "ver-1" });

    const res = await REQUEST_CODE(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ verificationId: "ver-1" });
    expect(requestCodeMock).toHaveBeenCalledWith({
      userId: "admin-1",
      actionType: "REGISTRATION_CANCEL_CONFIRMED",
      targetId: "reg-1",
    });
  });
});

describe("POST /api/admin/registrations/[id]/cancel-confirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminMock.mockResolvedValue({ allowed: true, session: { user: { id: "admin-1", role: "ADMIN" } } } as any);
    verifyCodeMock.mockResolvedValue({ ok: true });
    cancelMock.mockResolvedValue({ ok: true, refund: "processed" });
  });

  it("retorna 403 para quem não é admin", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);

    const res = await CONFIRM(makeRequest({ reason: "x", verificationId: "v", code: "123456" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a justificativa está vazia", async () => {
    const res = await CONFIRM(makeRequest({ reason: "", verificationId: "v", code: "123456" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o código é inválido, sem cancelar a inscrição", async () => {
    verifyCodeMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 3 });

    const res = await CONFIRM(makeRequest({ reason: "Pedido do admin", verificationId: "v", code: "000000" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Código incorreto.", attemptsRemaining: 3 });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("com código válido: cancela sem escopo de organizador e grava auditoria com o motivo", async () => {
    const res = await CONFIRM(
      makeRequest({ reason: "Pedido do admin", verificationId: "v", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "processed" });
    expect(verifyCodeMock).toHaveBeenCalledWith({
      verificationId: "v",
      userId: "admin-1",
      actionType: "REGISTRATION_CANCEL_CONFIRMED",
      targetId: "reg-1",
      code: "123456",
    });
    expect(cancelMock).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      reason: "Pedido do admin",
      actingUserId: "admin-1",
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REGISTRATION_CANCELLED_BY_ADMIN",
          entityId: "reg-1",
          metadata: { reason: "Pedido do admin", refund: "processed" },
        }),
      }),
    );
  });

  it("repassa erro e status quando o serviço falha", async () => {
    cancelMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Inscrição não encontrada" });

    const res = await CONFIRM(
      makeRequest({ reason: "Pedido do admin", verificationId: "v", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Inscrição não encontrada");
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });
});
