import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/events/[id]/payouts/route";
import { POST as REQUEST_CODE } from "@/app/api/admin/events/[id]/payouts/request-code/route";
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
const ctx = { params: Promise.resolve({ id: "event-1" }) };

function makeRequest(body: unknown = { verificationId: "v-1", code: "123456" }) {
  return new Request("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

describe("admin event payouts create api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyMock.mockResolvedValue({ ok: true });
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(403);
  });

  it("M2 — sem código 2FA → 400 e nada é gerado", async () => {
    const res = await POST(makeRequest({}), ctx);
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when there are no eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nenhum pedido/i);
  });

  it("creates the payout and returns 201", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([
      { id: "order-1", totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    ]);
    const txMock = {
      transferPayout: {
        create: vi.fn().mockResolvedValueOnce({ id: "payout-1", grossAmount: 10700, platformFee: 700, netAmount: 10000 }),
      },
      order: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }) },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(201);
    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "PAYOUT_STATUS_CHANGE", targetId: "event-1" }),
    );
    expect(await res.json()).toEqual({
      payout: { id: "payout-1", grossAmount: 10700, platformFee: 700, netAmount: 10000 },
    });
  });

  it("M2 — request-code exige admin e delega para requestSensitiveActionCode", async () => {
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "v-7" });
    const res = await REQUEST_CODE(
      new Request("http://localhost/x", { method: "POST" }) as any,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verificationId: "v-7" });
    expect(requestCodeMock).toHaveBeenCalledWith({
      userId: "admin-1",
      actionType: "PAYOUT_STATUS_CHANGE",
      targetId: "event-1",
    });
  });
});
