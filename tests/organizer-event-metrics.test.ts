import { describe, expect, it } from "vitest";
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";

describe("computeRegistrationStatusBreakdown", () => {
  it("maps groupBy counts to paid/pending/cancelled", () => {
    const result = computeRegistrationStatusBreakdown([
      { status: "CONFIRMED", count: 12 },
      { status: "PENDING_PAYMENT", count: 3 },
      { status: "CANCELLED", count: 1 },
    ]);
    expect(result).toEqual({ paid: 12, pending: 3, cancelled: 1 });
  });

  it("defaults missing statuses to zero", () => {
    const result = computeRegistrationStatusBreakdown([{ status: "CONFIRMED", count: 5 }]);
    expect(result).toEqual({ paid: 5, pending: 0, cancelled: 0 });
  });

  it("ignores statuses outside the tracked set", () => {
    const result = computeRegistrationStatusBreakdown([
      { status: "TRANSFERRED", count: 2 },
      { status: "WAITLISTED", count: 4 },
    ]);
    expect(result).toEqual({ paid: 0, pending: 0, cancelled: 0 });
  });
});

describe("computeSlotsInfo", () => {
  it("uses maxParticipants and active registrations when maxParticipants is set", () => {
    const result = computeSlotsInfo({
      maxParticipants: 100,
      activeRegistrationsCount: 40,
      batchCapacityTotal: 999,
      batchSoldTotal: 999,
    });
    expect(result).toEqual({ total: 100, remaining: 60 });
  });

  it("floors remaining at zero when active registrations exceed maxParticipants", () => {
    const result = computeSlotsInfo({
      maxParticipants: 50,
      activeRegistrationsCount: 55,
      batchCapacityTotal: 0,
      batchSoldTotal: 0,
    });
    expect(result).toEqual({ total: 50, remaining: 0 });
  });

  it("falls back to batch capacity/sold totals when maxParticipants is null", () => {
    const result = computeSlotsInfo({
      maxParticipants: null,
      activeRegistrationsCount: 999,
      batchCapacityTotal: 200,
      batchSoldTotal: 120,
    });
    expect(result).toEqual({ total: 200, remaining: 80 });
  });

  it("floors remaining at zero when sold exceeds batch capacity", () => {
    const result = computeSlotsInfo({
      maxParticipants: null,
      activeRegistrationsCount: 0,
      batchCapacityTotal: 100,
      batchSoldTotal: 130,
    });
    expect(result).toEqual({ total: 100, remaining: 0 });
  });
});

describe("computeDimensionBreakdowns", () => {
  it("counts and sums revenue per route, category, and ticket batch", () => {
    const result = computeDimensionBreakdowns([
      { routeId: "route-1", categoryId: "cat-1", ticketBatchId: "batch-1", orderSubtotalAmount: 10000 },
      { routeId: "route-1", categoryId: "cat-2", ticketBatchId: "batch-1", orderSubtotalAmount: 15000 },
      { routeId: "route-2", categoryId: "cat-1", ticketBatchId: "batch-2", orderSubtotalAmount: 20000 },
    ]);

    expect(result.byRoute.get("route-1")).toEqual({ count: 2, revenue: 25000 });
    expect(result.byRoute.get("route-2")).toEqual({ count: 1, revenue: 20000 });
    expect(result.byCategory.get("cat-1")).toEqual({ count: 2, revenue: 30000 });
    expect(result.byCategory.get("cat-2")).toEqual({ count: 1, revenue: 15000 });
    expect(result.byTicketBatch.get("batch-1")).toEqual({ count: 2, revenue: 25000 });
    expect(result.byTicketBatch.get("batch-2")).toEqual({ count: 1, revenue: 20000 });
  });

  it("ignores null routeId/categoryId without crashing or adding a null key", () => {
    const result = computeDimensionBreakdowns([
      { routeId: null, categoryId: null, ticketBatchId: "batch-1", orderSubtotalAmount: 5000 },
    ]);

    expect(result.byRoute.size).toBe(0);
    expect(result.byCategory.size).toBe(0);
    expect(result.byTicketBatch.get("batch-1")).toEqual({ count: 1, revenue: 5000 });
  });

  it("returns empty maps for an empty input", () => {
    const result = computeDimensionBreakdowns([]);
    expect(result.byRoute.size).toBe(0);
    expect(result.byCategory.size).toBe(0);
    expect(result.byTicketBatch.size).toBe(0);
  });
});

describe("buildPaymentMethodSummary", () => {
  it("always returns all 4 payment methods in a fixed order", () => {
    const result = buildPaymentMethodSummary([]);
    expect(result.map((r) => r.method)).toEqual(["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"]);
    expect(result.every((r) => r.count === 0 && r.revenue === 0)).toBe(true);
  });

  it("fills in real counts/revenue for methods that appear, zeroing the rest", () => {
    const result = buildPaymentMethodSummary([
      { method: "PIX", count: 10, revenue: 50000 },
      { method: "BOLETO", count: 2, revenue: 8000 },
    ]);

    expect(result).toEqual([
      { method: "PIX", count: 10, revenue: 50000 },
      { method: "CREDIT_CARD", count: 0, revenue: 0 },
      { method: "DEBIT_CARD", count: 0, revenue: 0 },
      { method: "BOLETO", count: 2, revenue: 8000 },
    ]);
  });
});
