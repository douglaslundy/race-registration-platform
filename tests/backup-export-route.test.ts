import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/backup/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin backup export api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    dbMock.user.findMany.mockResolvedValue([{ id: "u1", email: "a@a.com" }]);
    dbMock.athleteProfile.findMany.mockResolvedValue([{ id: "ap1", userId: "u1" }]);
    dbMock.event.findMany.mockResolvedValue([]);
    dbMock.registration.findMany.mockResolvedValue([]);
    dbMock.order.findMany.mockResolvedValue([]);
    dbMock.payment.findMany.mockResolvedValue([]);
    dbMock.coupon.findMany.mockResolvedValue([]);
    dbMock.organizerProfile.findMany.mockResolvedValue([]);
    dbMock.ticketBatch.findMany.mockResolvedValue([]);
    dbMock.eventCategory.findMany.mockResolvedValue([]);
    dbMock.eventRoute.findMany.mockResolvedValue([]);
    dbMock.refund.findMany.mockResolvedValue([]);
    dbMock.transferPayout.findMany.mockResolvedValue([]);
    dbMock.resultImport.findMany.mockResolvedValue([]);
    dbMock.raceResult.findMany.mockResolvedValue([]);
    dbMock.fileAsset.findMany.mockResolvedValue([]);
    dbMock.auditLog.findMany.mockResolvedValue([]);
    dbMock.platformSetting.findMany.mockResolvedValue([{ key: "app_name", value: "Corridas" }]);
    dbMock.alertLog.findMany.mockResolvedValue([]);
  });

  it("streams a JSON object with every table, including the newly added ones", async () => {
    const res = await GET(new Request("http://localhost/api/admin/backup") as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text);

    expect(Object.keys(data).sort()).toEqual(
      [
        "users", "athleteProfiles", "events", "registrations", "orders", "payments", "coupons",
        "organizerProfiles", "ticketBatches", "eventCategories", "eventRoutes", "transferPayouts",
        "resultImports", "raceResults", "fileAssets", "auditLogs", "platformSettings", "refunds",
        "alertLogs",
      ].sort(),
    );
    expect(data.users).toEqual([{ id: "u1", email: "a@a.com" }]);
    expect(data.platformSettings).toEqual([{ key: "app_name", value: "Corridas" }]);
  });
});
