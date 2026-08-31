import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDailySignups,
  getDailyRegistrations,
  getDailyCouponUsageByCode,
  getDailyRegistrationsByCouponPresence,
  organizerRevenueWhere,
  adminRevenueWhere,
} from "@/lib/dashboard-metrics";
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

describe("getDailyCouponUsageByCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters to orders with a coupon applied and scopes by organizerId", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    await getDailyCouponUsageByCode(from, to, { organizerId: "org-1" });
    expect(dbMock.order.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, couponId: { not: null }, event: { organizerId: "org-1" } },
      select: { createdAt: true, coupon: { select: { code: true } } },
    });
  });

  function order(day: string, code: string) {
    return { createdAt: new Date(`2026-01-0${day}T10:00:00.000Z`), coupon: { code } };
  }

  it("returns the 5 most used codes as series, most used first, and buckets per day", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([
      order("1", "A"), order("1", "A"), order("2", "A"),
      order("1", "B"), order("2", "B"),
      order("2", "C"),
      order("3", "D"),
      order("3", "E"),
      order("3", "F"),
    ]);

    const { data, series } = await getDailyCouponUsageByCode(from, to, {});

    expect(series).toHaveLength(5);
    expect(series[0]).toBe("A");
    expect(series).not.toContain(series.includes("F") ? "E" : "F"); // só 5 dos 6 códigos entram
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ label: "01/01", A: 2, B: 1 });
    expect(data[1]).toMatchObject({ label: "02/01", A: 1, B: 1, C: 1 });
  });

  it("returns empty series when no coupon was used", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    const { data, series } = await getDailyCouponUsageByCode(from, to, {});
    expect(series).toEqual([]);
    expect(data).toHaveLength(3);
  });
});

describe("getDailyRegistrationsByCouponPresence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("splits registrations by whether the order used a coupon", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      { createdAt: new Date("2026-01-01T10:00:00.000Z"), order: { couponId: "c1" } },
      { createdAt: new Date("2026-01-01T11:00:00.000Z"), order: { couponId: null } },
      { createdAt: new Date("2026-01-02T09:00:00.000Z"), order: { couponId: null } },
    ]);

    const { data, series } = await getDailyRegistrationsByCouponPresence(from, to, {});

    expect(series).toEqual(["Com cupom", "Sem cupom"]);
    expect(data[0]).toMatchObject({ label: "01/01", "Com cupom": 1, "Sem cupom": 1 });
    expect(data[1]).toMatchObject({ label: "02/01", "Com cupom": 0, "Sem cupom": 1 });
    expect(data[2]).toMatchObject({ label: "03/01", "Com cupom": 0, "Sem cupom": 0 });
  });

  it("scopes by organizerId and eventId", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);
    await getDailyRegistrationsByCouponPresence(from, to, { organizerId: "org-1", eventId: "event-1" });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to }, eventId: "event-1", event: { organizerId: "org-1" } },
      select: { createdAt: true, order: { select: { couponId: true } } },
    });
  });
});

describe("organizerRevenueWhere", () => {
  it("always scopes by organizer, PAID status and paidAt within the period", () => {
    const where = organizerRevenueWhere({ organizerId: "org-1", from, to });
    expect(where).toEqual({
      status: "PAID",
      event: { organizerId: "org-1" },
      payments: { some: { status: "PAID", paidAt: { gte: from, lte: to } } },
    });
  });

  it("restricts to the selected event when eventId is given (regression: revenue used to ignore the event filter)", () => {
    const where = organizerRevenueWhere({ organizerId: "org-1", from, to, eventId: "event-1" });
    expect(where).toMatchObject({ eventId: "event-1", event: { organizerId: "org-1" } });
  });

  it("omits the eventId key entirely when no event is selected", () => {
    expect(organizerRevenueWhere({ organizerId: "org-1", from, to })).not.toHaveProperty("eventId");
  });
});

describe("adminRevenueWhere", () => {
  it("scopes by PAID status and paidAt within the period, no event filter by default", () => {
    expect(adminRevenueWhere({ from, to })).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
    });
  });

  it("restricts to the selected event via order.eventId when eventId is given", () => {
    expect(adminRevenueWhere({ from, to, eventId: "event-1" })).toMatchObject({
      order: { is: { eventId: "event-1" } },
    });
  });
});
