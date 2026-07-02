import { describe, expect, it } from "vitest";
import {
  buildOrganizerOrderWhere,
  buildOrganizerPaymentWhere,
  buildOrganizerPayoutWhere,
} from "@/lib/organizer/report";

const from = new Date("2026-01-01T00:00:00.000Z");
const to = new Date("2026-01-31T23:59:59.999Z");
const organizerId = "org-1";

describe("buildOrganizerPaymentWhere", () => {
  it("scopes paid payments to the organizer's paid orders, no event filter", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", event: { organizerId: "org-1" } },
    });
  });

  it("scopes paid payments whose order was cancelled", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to }, "CANCELLED")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "CANCELLED", event: { organizerId: "org-1" } },
    });
  });

  it("adds the event filter to the order sub-clause when eventId is given", () => {
    expect(buildOrganizerPaymentWhere({ organizerId, from, to, eventId: "evt-1" }, "PAID")).toEqual({
      status: "PAID",
      paidAt: { gte: from, lte: to },
      order: { status: "PAID", event: { organizerId: "org-1" }, eventId: "evt-1" },
    });
  });
});

describe("buildOrganizerOrderWhere", () => {
  it("scopes by organizer and createdAt range only when no status or event given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to })).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds status when given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to }, "PAID")).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
      status: "PAID",
    });
  });

  it("adds eventId when given", () => {
    expect(buildOrganizerOrderWhere({ organizerId, from, to, eventId: "evt-1" })).toEqual({
      event: { organizerId: "org-1" },
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});

describe("buildOrganizerPayoutWhere", () => {
  it("scopes by organizer and createdAt range only when no eventId given", () => {
    expect(buildOrganizerPayoutWhere({ organizerId, from, to })).toEqual({
      organizerId: "org-1",
      createdAt: { gte: from, lte: to },
    });
  });

  it("adds eventId when given", () => {
    expect(buildOrganizerPayoutWhere({ organizerId, from, to, eventId: "evt-1" })).toEqual({
      organizerId: "org-1",
      createdAt: { gte: from, lte: to },
      eventId: "evt-1",
    });
  });
});
