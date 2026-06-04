import { describe, expect, it } from "vitest";
import { parseEnabledPaymentMethods } from "@/lib/payment-methods";

describe("payment methods settings", () => {
  it("normalizes and deduplicates enabled methods", () => {
    expect(parseEnabledPaymentMethods(" pix, credit_card, PIX , boleto ")).toEqual(["PIX", "CREDIT_CARD", "BOLETO"]);
  });

  it("falls back to defaults when nothing valid is configured", () => {
    expect(parseEnabledPaymentMethods("foo,bar")).toEqual(["PIX", "CREDIT_CARD", "BOLETO"]);
  });
});
