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

import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { POST } from "@/app/api/organizer/registrations/[id]/cancellation-decision/route";

const checkPermMock = vi.mocked(checkApiPermission);
const resolveScope = vi.mocked(resolveActingScope);
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);

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
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "organizer-1", role: "ORGANIZER" } } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValue(false);
    verifyCodeMock.mockResolvedValue({ ok: true });
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    checkPermMock.mockResolvedValue({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("retorna 400 para um corpo com decision inválida", async () => {
    const res = await POST(makeRequest({ decision: "MAYBE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("escopa a decisão às inscrições de eventos do organizador logado", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "processed" });
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    decideMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Inscrição não encontrada" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Inscrição não encontrada");
  });

  it("assistente de organizador com a permissão decide o cancelamento escopado ao evento do criador", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: true, session: { user: { id: "assistant-1", role: "ASSISTANT" } } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "assistant-1",
    });
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response(JSON.stringify({ error: "Não autorizado" }), { status: 403 }) } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("exige verificationId/code quando há pagamento pago e a decisão é APPROVE", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("segue com o código correto quando há pagamento pago", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(
      makeRequest({ decision: "APPROVE", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(verifyCodeMock).toHaveBeenCalledWith({
      verificationId: "code-1",
      userId: "organizer-1",
      actionType: "PAYMENT_REFUND",
      targetId: "reg-1",
      code: "123456",
    });
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("retorna 400 quando o código é inválido, sem decidir o cancelamento", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);
    verifyCodeMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 3 });

    const res = await POST(
      makeRequest({ decision: "APPROVE", verificationId: "code-1", code: "000000" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Código incorreto.", attemptsRemaining: 3 });
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("não exige código pra REJECT (nunca mexe em pagamento)", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    decideMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(registrationHasPaidPayment).not.toHaveBeenCalled();
  });
});
