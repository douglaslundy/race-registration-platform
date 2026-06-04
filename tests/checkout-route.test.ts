import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { auth } from "@/lib/auth";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/payment-methods", () => ({
  getEnabledPaymentMethods: vi.fn(),
}));

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const dbMock = db as any;

describe("checkout api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
  });

  it("rejects a disabled payment method before creating the checkout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "BOLETO",
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.payment.create).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
});
