import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("createCheckout — restrição de tamanho de camiseta por data", () => {
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

  const createTx = (event: any) => ({
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
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
    },
  });

  it("permite um tamanho fora da lista restrita quando a data de corte ainda não chegou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2099-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "PP" as any,
      }),
    ).resolves.toBeDefined();
  });

  it("rejeita um tamanho fora da lista restrita quando a data de corte já passou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2000-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "PP" as any,
      }),
    ).rejects.toThrow("Tamanho de camiseta indisponível para este evento");
  });

  it("permite o tamanho que continua na lista restrita depois da data de corte", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2000-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "G" as any,
      }),
    ).resolves.toBeDefined();
  });
});
