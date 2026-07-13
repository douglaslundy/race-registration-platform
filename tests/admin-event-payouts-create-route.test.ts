import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/events/[id]/payouts/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("admin event payouts create api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 400 when there are no eligible orders", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ organizerId: "org-1" });
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
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

    const res = await POST(new Request("http://localhost/x", { method: "POST" }) as any, ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      payout: { id: "payout-1", grossAmount: 10700, platformFee: 700, netAmount: 10000 },
    });
  });
});
