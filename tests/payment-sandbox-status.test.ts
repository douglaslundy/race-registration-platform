import { describe, expect, it } from "vitest";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

describe("SandboxPaymentProvider.checkPaymentStatus", () => {
  it("sempre retorna PENDING (não há gateway real para consultar)", async () => {
    const provider = new SandboxPaymentProvider();
    const result = await provider.checkPaymentStatus("sandbox_abc");
    expect(result).toBe("PENDING");
  });
});
