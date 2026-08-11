import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation, registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  decideRegistrationCancellation: vi.fn(),
  registrationHasPaidPayment: vi.fn(),
}));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const decideMock = vi.mocked(decideRegistrationCancellation);

import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { POST } from "@/app/api/admin/registrations/[id]/cancellation-decision/route";

const checkAdminMock = vi.mocked(checkAdminOnlyApiPermission);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminMock.mockResolvedValue({ allowed: true, session: { user: { id: "admin-1", role: "ADMIN" } } } as any);
    vi.mocked(registrationHasPaidPayment).mockResolvedValue(false);
    vi.mocked(verifySensitiveActionCode).mockResolvedValue({ ok: true });
  });

  it("retorna 403 para quem não é admin", async () => {
    checkAdminMock.mockResolvedValue({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer inscrição)", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "not_applicable" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "not_applicable" });
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "admin-1" });
  });

  it("assistente de admin com a permissão decide o cancelamento (bypass também vale pra ele)", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: true, session: { user: { id: "assistant-1", role: "ASSISTANT" } } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    decideMock.mockResolvedValueOnce({ ok: true, refund: "not_applicable" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "assistant-1" });
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("exige verificationId/code quando há pagamento pago e a decisão é APPROVE", async () => {
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("segue com o código correto quando há pagamento pago", async () => {
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(
      makeRequest({ decision: "APPROVE", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "admin-1" });
  });

  it("não exige código pra REJECT (nunca mexe em pagamento)", async () => {
    decideMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(registrationHasPaidPayment).not.toHaveBeenCalled();
  });
});
