import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/payouts/[id]/route";
import { POST as REQUEST_CODE } from "@/app/api/admin/payouts/[id]/request-code/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  verifySensitiveActionCode,
  requestSensitiveActionCode,
} from "@/lib/security/sensitive-action-verification";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  verifySensitiveActionCode: vi.fn(),
  requestSensitiveActionCode: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const verifyMock = vi.mocked(verifySensitiveActionCode);
const requestCodeMock = vi.mocked(requestSensitiveActionCode);
const ctx = { params: Promise.resolve({ id: "payout-1" }) };

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/payouts/payout-1", {
    method: "PATCH",
    body: JSON.stringify({ verificationId: "v-1", code: "123456", ...body }),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

describe("admin payout status api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyMock.mockResolvedValue({ ok: true });
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ status: "PROCESSING" }), ctx);
    expect(res.status).toBe(403);
  });

  it("rejects an invalid status value", async () => {
    const res = await PATCH(makeRequest({ status: "PENDING" }), ctx);
    expect(res.status).toBe(400);
  });

  it("M2 — sem código 2FA → 400 e nada muda", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/admin/payouts/payout-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "PROCESSING" }),
        headers: { "Content-Type": "application/json" },
      }) as any,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the payout does not exist", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ status: "PROCESSING" }), ctx);
    expect(res.status).toBe(404);
  });

  it("updates the status on a valid transition", async () => {
    dbMock.transferPayout.findUnique.mockResolvedValueOnce({ id: "payout-1", status: "PENDING" });
    const txMock = {
      transferPayout: { update: vi.fn().mockResolvedValueOnce({ id: "payout-1", status: "COMPLETED" }) },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await PATCH(makeRequest({ status: "COMPLETED", note: "Pago via TED" }), ctx);
    expect(res.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "PAYOUT_STATUS_CHANGE", targetId: "payout-1" }),
    );
    expect(await res.json()).toEqual({ payout: { id: "payout-1", status: "COMPLETED" } });
  });

  it("M2 — request-code delega para requestSensitiveActionCode", async () => {
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "v-3" });
    const res = await REQUEST_CODE(
      new Request("http://localhost/x", { method: "POST" }) as any,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(requestCodeMock).toHaveBeenCalledWith({
      userId: "admin-1",
      actionType: "PAYOUT_STATUS_CHANGE",
      targetId: "payout-1",
    });
  });
});
