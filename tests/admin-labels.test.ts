import { describe, expect, it } from "vitest";
import { PAYMENT_STATUS_LABEL } from "@/lib/admin/labels";

describe("PAYMENT_STATUS_LABEL", () => {
  it("includes every PaymentStatus value the admin filter must offer, including CANCELLED", () => {
    expect(Object.keys(PAYMENT_STATUS_LABEL)).toEqual([
      "PENDING",
      "PAID",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
      "CHARGEBACK",
    ]);
  });
});
