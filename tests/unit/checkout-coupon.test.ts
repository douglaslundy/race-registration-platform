import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("createCheckout coupon handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies coupon discount after trimming and uppercasing the code", async () => {
    const tx = {
      ticketBatch: {
        findUnique: vi.fn().mockResolvedValue({ id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 20000 }),
        update: vi.fn().mockResolvedValue({}),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({ id: "event-1", status: "REGISTRATIONS_OPEN", platformFeePercent: 1100 }),
      },
      coupon: {
        findFirst: vi.fn().mockResolvedValue({
          id: "coupon-1",
          discountType: "PERCENT",
          discountValue: 10,
          maxUses: null,
          usedCount: 0,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      order: {
        create: vi.fn().mockResolvedValue({ id: "order-1" }),
      },
      registration: {
        create: vi.fn().mockResolvedValue({ id: "reg-1" }),
      },
    };

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
      couponCode: "  welcome10  ",
    });

    expect(tx.coupon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: "WELCOME10" }) }),
    );
    expect(tx.coupon.update).toHaveBeenCalledTimes(1);
    expect(result.discountAmount).toBe(2000);
    expect(result.subtotalAmount).toBe(18000);
    expect(result.totalAmount).toBe(18000);
  });

  it("rejects an invalid coupon", async () => {
    const tx = {
      ticketBatch: {
        findUnique: vi.fn().mockResolvedValue({ id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 20000 }),
        update: vi.fn().mockResolvedValue({}),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({ id: "event-1", status: "REGISTRATIONS_OPEN", platformFeePercent: 1100 }),
      },
      coupon: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      order: {
        create: vi.fn(),
      },
      registration: {
        create: vi.fn(),
      },
    };

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        couponCode: "INVALID",
      }),
    ).rejects.toThrow("Cupom inválido");
  });
});
