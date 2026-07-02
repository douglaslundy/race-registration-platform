import { describe, expect, it } from "vitest";
import {
  buildReportOrderWhere,
  buildReportPaymentWhere,
  buildReportRegistrationWhere,
} from "@/lib/admin/report";

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-31T23:59:59.999Z");

describe("buildReportPaymentWhere", () => {
  it("filters paid payments whose order is still paid, no event filter", () => {
    expect(buildReportPaymentWhere({ from, to }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID" },
    });
  });

  it("filters paid payments whose order was cancelled", () => {
    expect(buildReportPaymentWhere({ from, to }, "CANCELLED")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "CANCELLED" },
    });
  });

  it("adds the event filter to the order sub-clause when eventId is given", () => {
    expect(buildReportPaymentWhere({ from, to, eventId: "evt-1" }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", eventId: "evt-1" },
    });
  });
});

describe("buildReportOrderWhere", () => {
  it("filters by createdAt range only when no status or event given", () => {
    expect(buildReportOrderWhere({ from, to })).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds status when given", () => {
    expect(buildReportOrderWhere({ from, to }, "PAID")).toEqual({
      createdAt: { gte: from, lte: to },
      status: "PAID",
    });
  });

  it("adds eventId when given", () => {
    expect(buildReportOrderWhere({ from, to, eventId: "evt-1" })).toEqual({
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });

  it("combines status and eventId", () => {
    expect(buildReportOrderWhere({ from, to, eventId: "evt-1" }, "PAID")).toEqual({
      createdAt: { gte: from, lte: to },
      status: "PAID",
      eventId: "evt-1",
    });
  });
});

describe("buildReportRegistrationWhere", () => {
  it("filters by createdAt range only when no eventId given", () => {
    expect(buildReportRegistrationWhere({ from, to })).toEqual({
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds eventId when given", () => {
    expect(buildReportRegistrationWhere({ from, to, eventId: "evt-1" })).toEqual({
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});
