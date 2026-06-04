import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/audit/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin audit export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports audit logs as csv", async () => {
    dbMock.auditLog.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-02-01T12:00:00.000Z"),
        user: { name: "Admin", email: "admin@exemplo.com" },
        action: "USER_CREATED",
        entityType: "User",
        entityId: "user-1",
        metadata: { source: "test" },
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/audit/export?action=USER_CREATED&entity=User&userId=user-1", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("auditoria.csv");
    expect(dbMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ action: expect.objectContaining({ contains: "USER_CREATED" }) }),
            expect.objectContaining({ entityType: "User" }),
            expect.objectContaining({ userId: "user-1" }),
          ]),
        }),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"USER_CREATED"');
    expect(csv).toContain('"Admin"');
    expect(csv).toContain('"admin@exemplo.com"');
  });
});
