import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

const ticketBatch = { id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 10000 };

function makeTx(eventOverrides: Record<string, unknown> = {}) {
  const event = {
    id: "event-1",
    status: "REGISTRATIONS_OPEN",
    platformFeePercent: 500, // 5%
    pixServiceFeeDiscountPercent: null,
    allowProxyRegistration: false,
    ...eventOverrides,
  };
  return {
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: { findUnique: vi.fn().mockResolvedValue(event) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    eventRoute: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    eventCategory: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    coupon: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    order: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "order-1", ...data })) },
    registration: { create: vi.fn().mockResolvedValue({ id: "reg-1" }) },
  };
}

describe("createCheckout — desconto PIX sobre a Taxa de Serviço", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // service_fee_percent = 1000 bps (10%), service_fee_min = 0, pix discount global = 20
    dbMock.platformSetting.findUnique.mockImplementation(async ({ where }: any) => {
      const map: Record<string, string> = {
        default_platform_fee: "0",
        service_fee_percent: "1000",
        service_fee_min: "0",
        pix_service_fee_discount_percent: "20",
      };
      return where.key in map ? { key: where.key, value: map[where.key] } : null;
    });
  });

  it("PIX: grava serviço original, desconto e líquida separados; total com desconto", async () => {
    const tx = makeTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.platformFeeAmount).toBe(500);
    expect(orderData.serviceFeeOriginalAmount).toBe(1000);
    expect(orderData.pixDiscountAmount).toBe(200);
    expect(orderData.pixDiscountPercent).toBe(20);
    expect(orderData.paymentFeeAmount).toBe(800); // LÍQUIDA
    expect(orderData.totalAmount).toBe(11300);
    expect(result.totalAmount).toBe(11300);
    expect(result.pixDiscountAmount).toBe(200);
  });

  it("cartão (isPix false): taxa de serviço cheia, desconto zero, plataforma idêntica", async () => {
    const tx = makeTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: false,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.platformFeeAmount).toBe(500); // IDÊNTICA ao caso PIX
    expect(orderData.serviceFeeOriginalAmount).toBe(1000);
    expect(orderData.paymentFeeAmount).toBe(1000);
    expect(orderData.pixDiscountAmount).toBe(0);
    expect(orderData.pixDiscountPercent).toBe(0);
    expect(orderData.totalAmount).toBe(11500);
  });

  it("evento com pixServiceFeeDiscountPercent = 0 ignora a global > 0", async () => {
    const tx = makeTx({ pixServiceFeeDiscountPercent: 0 });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.pixDiscountAmount).toBe(0);
    expect(orderData.paymentFeeAmount).toBe(1000);
  });

  it("evento com pixServiceFeeDiscountPercent próprio sobrepõe a global", async () => {
    const tx = makeTx({ pixServiceFeeDiscountPercent: 50 });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.pixDiscountAmount).toBe(500);
    expect(orderData.paymentFeeAmount).toBe(500);
  });
});
