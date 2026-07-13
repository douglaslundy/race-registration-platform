import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDailySignups, getDailyRegistrations, getDailyCouponUsage } from "@/lib/dashboard-metrics";
import { db } from "@/lib/db";

const dbMock = db as any;

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-03T23:59:59.999Z");

describe("getDailySignups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fills every day in range with zero when there are no rows", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);
    const result = await getDailySignups(from, to);
    expect(result).toEqual([
      { label: "01/01", value: 0 },
      { label: "02/01", value: 0 },
      { label: "03/01", value: 0 },
    ]);
  });

  it("counts multiple rows on the same day and buckets each day correctly", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { createdAt: new Date("2026-01-02T08:00:00.000Z") },
      { createdAt: new Date("2026-01-02T20:00:00.000Z") },
      { createdAt: new Date("2026-01-03T01:00:00.000Z") },
    ]);
    const result = await getDailySignups(from, to);
    expect(result).toEqual([
      { label: "01/01", value: 0 },
      { label: "02/01", value: 2 },
      { label: "03/01", value: 1 },
    ]);
  });
});

describe("getDailyRegistrations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries unscoped when no organizerId/eventId given", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, {});
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    });
  });

  it("scopes by organizerId only", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, { organizerId: "org-1" });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });

  it("scopes by eventId AND organizerId together when both are given", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrations(from, to, { organizerId: "org-1", eventId: "event-1" });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, eventId: "event-1", event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });
});

describe("getDailyCouponUsage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters to orders with a coupon applied, unscoped", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    await getDailyCouponUsage(from, to, {});
    expect(dbMock.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, couponId: { not: null } },
      select: { createdAt: true },
    });
  });

  it("scopes by organizerId", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    await getDailyCouponUsage(from, to, { organizerId: "org-1" });
    expect(dbMock.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, couponId: { not: null }, event: { organizerId: "org-1" } },
      select: { createdAt: true },
    });
  });
});
