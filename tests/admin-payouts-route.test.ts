import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/payouts/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin payouts export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports payouts as csv with filters", async () => {
    dbMock.transferPayout.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-02-05T12:00:00.000Z"),
        event: { title: "Corrida das Pedras" },
        organizer: { user: { name: "Organizador Um", email: "org@exemplo.com" } },
        grossAmount: 50000,
        platformFee: 5000,
        netAmount: 45000,
        status: "COMPLETED",
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/payouts/export?status=COMPLETED&q=pedras&sort=grossAmount&dir=asc", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("repasses.csv");
    expect(dbMock.transferPayout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
        orderBy: expect.arrayContaining([expect.objectContaining({ grossAmount: "asc" })]),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain('"Organizador Um"');
    expect(csv).toContain('"COMPLETED"');
  });
});
