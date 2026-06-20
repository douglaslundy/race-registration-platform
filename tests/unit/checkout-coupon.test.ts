import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("createCheckout coupon handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ticketBatch = {
    id: "batch-1",
    active: true,
    soldCount: 0,
    capacity: 10,
    priceAmount: 20000,
  };

  const event = {
    id: "event-1",
    status: "REGISTRATIONS_OPEN",
    platformFeePercent: 1100,
  };

  const createTx = (coupon: Record<string, unknown> | null) => ({
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
    },
    eventRoute: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventCategory: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    coupon: {
      findFirst: vi.fn().mockResolvedValue(coupon),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
    },
  });

  it("applies coupon discount after trimming and uppercasing the code", async () => {
    const tx = createTx({
      id: "coupon-1",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: null,
      usedCount: 0,
    });

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
    expect(result.platformFeeAmount).toBe(1980);
    expect(result.totalAmount).toBe(19980);
  });

  it("requires a route when the event has routes", async () => {
    const tx = createTx(null);
    tx.eventRoute.count.mockResolvedValue(1);

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
      }),
    ).rejects.toThrow("Selecione um percurso");
  });

  it("requires a category when the event has categories", async () => {
    const tx = createTx(null);
    tx.eventCategory.count.mockResolvedValue(1);

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        routeId: "route-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
      }),
    ).rejects.toThrow("Selecione uma categoria");
  });

  it("rejects an invalid coupon", async () => {
    const tx = createTx(null);

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
