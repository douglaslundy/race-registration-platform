import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/refund/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/organizer/registrations/[id]/refund/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 404 quando a inscrição não pertence ao organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(404);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há pagamento pago pra essa inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [] } });
    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código pro pagamento da inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "org-user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(res.status).toBe(200);
    expect(body).toEqual({ verificationId: "code-1" });
  });

  it("assistente de organizador resolve o organizerUserId antes de buscar a inscrição", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "assistant-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(res.status).toBe(200);
  });
});
