import { describe, expect, it } from "vitest";
import { computeRegistrationStatusBreakdown, computeSlotsInfo } from "@/lib/organizer/event-metrics";

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
