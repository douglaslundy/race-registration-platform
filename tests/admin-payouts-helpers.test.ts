import { describe, expect, it } from "vitest";
import { hasPostPayoutRefund } from "@/lib/admin/payouts";

describe("hasPostPayoutRefund", () => {
  it("returns false for an empty array", () => {
    expect(hasPostPayoutRefund([])).toBe(false);
  });

  it("returns true when at least one order is present", () => {
    expect(hasPostPayoutRefund([{ status: "REFUNDED" }])).toBe(true);
  });

  it("returns true for multiple orders", () => {
    expect(hasPostPayoutRefund([{ status: "REFUNDED" }, { status: "REFUNDED" }])).toBe(true);
  });
});
