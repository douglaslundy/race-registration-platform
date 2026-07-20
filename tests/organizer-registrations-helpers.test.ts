import { describe, expect, it } from "vitest";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";

describe("buildRegistrationOrderBy", () => {
  it("defaults to chronological ascending when no params given", () => {
    const result = buildRegistrationOrderBy("", "");
    expect(result).toEqual({ orderBy: { createdAt: "asc" }, normalizedSort: "date", normalizedDir: "asc" });
  });

  it("sorts alphabetically by athlete name", () => {
    const result = buildRegistrationOrderBy("name", "asc");
    expect(result).toEqual({ orderBy: { athlete: { name: "asc" } }, normalizedSort: "name", normalizedDir: "asc" });
  });

  it("sorts chronologically descending", () => {
    const result = buildRegistrationOrderBy("date", "desc");
    expect(result).toEqual({ orderBy: { createdAt: "desc" }, normalizedSort: "date", normalizedDir: "desc" });
  });

  it("treats any non-desc dir as ascending", () => {
    const result = buildRegistrationOrderBy("name", "sideways");
    expect(result.normalizedDir).toBe("asc");
  });
});

describe("buildRegistrationWhere", () => {
  it("filters by eventId only when no filters given", () => {
    expect(buildRegistrationWhere("evt-1")).toEqual({ eventId: "evt-1" });
  });

  it("filters by eventId only when filters object is empty", () => {
    expect(buildRegistrationWhere("evt-1", {})).toEqual({ eventId: "evt-1" });
  });

  it("adds status filter when a valid status is given", () => {
    expect(buildRegistrationWhere("evt-1", { status: "CONFIRMED" })).toEqual({ eventId: "evt-1", status: "CONFIRMED" });
  });

  it("adds status filter for CANCELLATION_REQUESTED", () => {
    expect(buildRegistrationWhere("evt-1", { status: "CANCELLATION_REQUESTED" })).toEqual({
      eventId: "evt-1",
      status: "CANCELLATION_REQUESTED",
    });
  });

  it("filters by refunded/chargeback payment status for REFUNDED", () => {
    expect(buildRegistrationWhere("evt-1", { status: "REFUNDED" })).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] } } } },
    });
  });

  it("ignores invalid status values", () => {
    expect(buildRegistrationWhere("evt-1", { status: "NOT_A_STATUS" })).toEqual({ eventId: "evt-1" });
  });

  it("ignores empty string status", () => {
    expect(buildRegistrationWhere("evt-1", { status: "" })).toEqual({ eventId: "evt-1" });
  });

  it("searches by order id, athlete name and email when q has no digits", () => {
    expect(buildRegistrationWhere("evt-1", { q: "maria" })).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "maria", mode: "insensitive" } },
        { athlete: { name: { contains: "maria", mode: "insensitive" } } },
        { athlete: { email: { contains: "maria", mode: "insensitive" } } },
      ],
    });
  });

  it("also matches athlete CPF when q contains digits", () => {
    expect(buildRegistrationWhere("evt-1", { q: "111.444.777-35" })).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "111.444.777-35", mode: "insensitive" } },
        { athlete: { name: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { email: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { athleteProfile: { cpf: { contains: "11144477735" } } } },
      ],
    });
  });

  it("filters by categoryId", () => {
    expect(buildRegistrationWhere("evt-1", { categoryId: "cat-1" })).toEqual({
      eventId: "evt-1",
      categoryId: "cat-1",
    });
  });

  it("filters by routeId", () => {
    expect(buildRegistrationWhere("evt-1", { routeId: "route-1" })).toEqual({
      eventId: "evt-1",
      routeId: "route-1",
    });
  });

  it("filters by ticketBatchId", () => {
    expect(buildRegistrationWhere("evt-1", { ticketBatchId: "batch-1" })).toEqual({
      eventId: "evt-1",
      ticketBatchId: "batch-1",
    });
  });

  it("filters by couponId via the order relation", () => {
    expect(buildRegistrationWhere("evt-1", { couponId: "coupon-1" })).toEqual({
      eventId: "evt-1",
      order: { couponId: "coupon-1" },
    });
  });

  it("filters registrations without coupon when couponId is the 'none' sentinel", () => {
    expect(buildRegistrationWhere("evt-1", { couponId: "none" })).toEqual({
      eventId: "evt-1",
      order: { couponId: null },
    });
  });

  it("merges the 'none' coupon sentinel with paymentMethod into a single order filter", () => {
    expect(
      buildRegistrationWhere("evt-1", { couponId: "none", paymentMethod: "PIX" }),
    ).toEqual({
      eventId: "evt-1",
      order: { couponId: null, payments: { some: { method: "PIX" } } },
    });
  });

  it("filters by paymentMethod via any payment on the order", () => {
    expect(buildRegistrationWhere("evt-1", { paymentMethod: "PIX" })).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { method: "PIX" } } },
    });
  });

  it("combines multiple filters at once", () => {
    expect(
      buildRegistrationWhere("evt-1", { status: "CONFIRMED", categoryId: "cat-1", routeId: "route-1" }),
    ).toEqual({
      eventId: "evt-1",
      status: "CONFIRMED",
      categoryId: "cat-1",
      routeId: "route-1",
    });
  });

  it("merges couponId and paymentMethod into a single order filter instead of one overwriting the other", () => {
    expect(
      buildRegistrationWhere("evt-1", { couponId: "coupon-1", paymentMethod: "PIX" }),
    ).toEqual({
      eventId: "evt-1",
      order: { couponId: "coupon-1", payments: { some: { method: "PIX" } } },
    });
  });

  it("merges the REFUNDED status's payment condition with paymentMethod into the same payments.some clause", () => {
    expect(
      buildRegistrationWhere("evt-1", { status: "REFUNDED", paymentMethod: "PIX" }),
    ).toEqual({
      eventId: "evt-1",
      order: { payments: { some: { status: { in: ["REFUNDED", "CHARGEBACK"] }, method: "PIX" } } },
    });
  });

  it("filters by createdAt >= dateFrom (início do dia em Brasília)", () => {
    const result = buildRegistrationWhere("evt-1", { dateFrom: "2026-07-10" });
    expect(result).toEqual({
      eventId: "evt-1",
      createdAt: { gte: new Date("2026-07-10T03:00:00.000Z") },
    });
  });

  it("filters by createdAt <= dateTo (fim do dia em Brasília)", () => {
    const result = buildRegistrationWhere("evt-1", { dateTo: "2026-07-10" });
    expect(result).toEqual({
      eventId: "evt-1",
      createdAt: { lte: new Date("2026-07-11T02:59:59.999Z") },
    });
  });

  it("combines dateFrom and dateTo into a single createdAt range", () => {
    const result = buildRegistrationWhere("evt-1", { dateFrom: "2026-07-10", dateTo: "2026-07-12" });
    expect(result).toEqual({
      eventId: "evt-1",
      createdAt: {
        gte: new Date("2026-07-10T03:00:00.000Z"),
        lte: new Date("2026-07-13T02:59:59.999Z"),
      },
    });
  });

  it("ignores empty dateFrom/dateTo strings", () => {
    expect(buildRegistrationWhere("evt-1", { dateFrom: "", dateTo: "" })).toEqual({ eventId: "evt-1" });
  });
});
