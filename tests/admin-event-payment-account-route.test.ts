import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  verifySensitiveActionCode: vi.fn(),
  requestSensitiveActionCode: vi.fn(),
}));

import { POST } from "@/app/api/admin/events/[id]/payment-account/route";
import { POST as REQUEST_CODE } from "@/app/api/admin/events/[id]/payment-account/request-code/route";
import {
  verifySensitiveActionCode,
  requestSensitiveActionCode,
} from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const verifyMock = vi.mocked(verifySensitiveActionCode);
const requestMock = vi.mocked(requestSensitiveActionCode);

function req(body: unknown = {}) {
  return new Request("http://localhost/api/admin/events/ev-1/payment-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_2FA = { verificationId: "v-1", code: "123456" };

describe("POST /api/admin/events/[id]/payment-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyMock.mockResolvedValue({ ok: true });
    dbMock.event.update.mockResolvedValue({});
    dbMock.auditLog.create.mockResolvedValue({});
  });

  it("sem 2FA → 400 e não altera o evento", async () => {
    const res = await POST(req({ paymentAccountId: "acc_x" }), ctx("ev-1"));
    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("código inválido → 400", async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 2 });
    const res = await POST(req({ paymentAccountId: "acc_x", ...VALID_2FA }), ctx("ev-1"));
    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("código válido + conta não-arquivada → grava override e auditoria", async () => {
    dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ id: "acc_x", archivedAt: null });
    const res = await POST(req({ paymentAccountId: "acc_x", ...VALID_2FA }), ctx("ev-1"));
    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "ev-1" },
      data: { paymentAccountId: "acc_x" },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "EVENT_PAYMENT_ACCOUNT_CHANGED",
        entityId: "ev-1",
        metadata: { paymentAccountId: "acc_x" },
      }),
    });
  });

  it("paymentAccountId: null → volta pro default", async () => {
    const res = await POST(req({ paymentAccountId: null, ...VALID_2FA }), ctx("ev-1"));
    expect(res.status).toBe(200);
    expect(dbMock.paymentAccount.findUnique).not.toHaveBeenCalled();
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "ev-1" },
      data: { paymentAccountId: null },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "EVENT_PAYMENT_ACCOUNT_CHANGED",
        metadata: { paymentAccountId: null },
      }),
    });
  });

  it("conta arquivada → 400 sem alterar o evento", async () => {
    dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ id: "acc_x", archivedAt: new Date() });
    const res = await POST(req({ paymentAccountId: "acc_x", ...VALID_2FA }), ctx("ev-1"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Conta inválida ou arquivada");
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("conta inexistente → 400", async () => {
    dbMock.paymentAccount.findUnique.mockResolvedValueOnce(null);
    const res = await POST(req({ paymentAccountId: "acc_missing", ...VALID_2FA }), ctx("ev-1"));
    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("não-admin → 403", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(req({ paymentAccountId: null, ...VALID_2FA }), ctx("ev-1"));
    expect(res.status).toBe(403);
  });

  describe("request-code", () => {
    it("admin → retorna verificationId", async () => {
      requestMock.mockResolvedValueOnce({ ok: true, verificationId: "v-9" });
      const res = await REQUEST_CODE(req({}), ctx("ev-1"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ verificationId: "v-9" });
      expect(requestMock).toHaveBeenCalledWith({
        userId: "admin-1",
        actionType: "PAYMENT_ACCOUNT_CHANGE",
        targetId: "ev-1",
      });
    });

    it("não-admin → 403", async () => {
      authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
      const res = await REQUEST_CODE(req({}), ctx("ev-1"));
      expect(res.status).toBe(403);
    });
  });
});
