import { describe, expect, it } from "vitest";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

describe("SandboxPaymentProvider.refundPayment", () => {
  it("returns a synthetic refund id without any network call", async () => {
    const provider = new SandboxPaymentProvider();
    const result = await provider.refundPayment({ providerPaymentId: "sandbox_abc" });
    expect(result).toEqual({ providerRefundId: "sandbox_refund_sandbox_abc" });
  });
});
