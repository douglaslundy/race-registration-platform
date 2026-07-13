import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/payouts/[id]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "payout-1" }) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/payouts/payout-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

describe("admin payout status api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
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
    expect(await res.json()).toEqual({ payout: { id: "payout-1", status: "COMPLETED" } });
  });
});
