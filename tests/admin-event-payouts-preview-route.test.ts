import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/events/[id]/payouts/preview/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("admin event payouts preview api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("rejects non-admin callers", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u-1", role: "ORGANIZER" } } as any);
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 404 when the event does not exist", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(404);
  });

  it("returns the computed preview totals", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 1 },
      _sum: { totalAmount: 10700, platformFeeAmount: 500, paymentFeeAmount: 200 },
    });
    const res = await GET(new Request("http://localhost/x") as any, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderCount: 1, grossAmount: 10700, platformFee: 700, netAmount: 10000 });
  });
});
