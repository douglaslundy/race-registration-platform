import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  registrationHasPaidPayment: vi.fn(),
}));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { checkAdminOnlyApiPermission, checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { POST as adminPost } from "@/app/api/admin/registrations/[id]/cancellation-decision/request-code/route";
import { POST as organizerPost } from "@/app/api/organizer/registrations/[id]/cancellation-decision/request-code/route";

const checkAdminMock = vi.mocked(checkAdminOnlyApiPermission);
const checkOrgMock = vi.mocked(checkApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const hasPaidMock = vi.mocked(registrationHasPaidPayment);
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/registrations/[id]/cancellation-decision/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminMock.mockResolvedValue({ allowed: true, session: { user: { id: "admin-1", role: "ADMIN" } } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: false, response: new Response(null, { status: 403 }) } as any);
    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(403);
  });

  it("retorna 400 quando não há pagamento pago (não faz sentido pedir código)", async () => {
    hasPaidMock.mockResolvedValueOnce(false);
    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código quando há pagamento pago", async () => {
    hasPaidMock.mockResolvedValueOnce(true);
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    const body = await res.json();

    expect(hasPaidMock).toHaveBeenCalledWith({ id: "reg-1" });
    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "reg-1" });
    expect(body).toEqual({ verificationId: "code-1" });
  });
});

describe("POST /api/organizer/registrations/[id]/cancellation-decision/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkOrgMock.mockResolvedValue({ allowed: true, session: { user: { id: "org-user-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ organizerId: "org-1" } as any);
  });

  it("escopa a checagem de pagamento pago pelo organizador dono do evento", async () => {
    hasPaidMock.mockResolvedValueOnce(true);
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    await organizerPost(new Request("http://localhost") as any, makeContext("reg-1"));

    expect(hasPaidMock).toHaveBeenCalledWith({ id: "reg-1", event: { organizerId: "org-1" } });
  });

  it("retorna 400 quando não há pagamento pago", async () => {
    hasPaidMock.mockResolvedValueOnce(false);
    const res = await organizerPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });
});
