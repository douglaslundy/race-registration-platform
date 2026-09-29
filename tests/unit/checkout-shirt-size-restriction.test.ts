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
    hasShirt: true,
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
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    eventRoute: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventCategory: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },
    coupon: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
      count: vi.fn().mockResolvedValue(0),
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

  it("rejeita a inscrição quando nenhum tamanho de camiseta é informado", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
      } as any),
    ).rejects.toThrow("Selecione o tamanho de camiseta");
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it("não exige nem grava tamanho de camiseta quando o lote não inclui camiseta", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.ticketBatch.findUnique.mockResolvedValue({ ...ticketBatch, hasShirt: false });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
      shirtSize: "G" as any, // enviado mesmo assim — deve ser ignorado
    } as any);

    expect(result).toBeDefined();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shirtSize: undefined }) }),
    );
  });

  it("rejeita quando o tamanho escolhido já atingiu a quota configurada para o evento", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "M", quantity: 5 });
    tx.registration.count.mockResolvedValueOnce(5);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "M" as any,
      } as any),
    ).rejects.toThrow("Tamanho de camiseta esgotado para este evento");
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.registration.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "CANCELLED" } }) }),
    );
  });

  it("aceita quando o tamanho escolhido tem quota configurada mas ainda não esgotou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "M", quantity: 5 });
    tx.registration.count.mockResolvedValueOnce(4);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "M" as any,
      } as any),
    ).resolves.toBeDefined();
  });

  it("rejeita imediatamente um tamanho com quota configurada como 0 (esgotado desde já)", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "PP", quantity: 0 });
    tx.registration.count.mockResolvedValueOnce(0);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "PP" as any,
      } as any),
    ).rejects.toThrow("Tamanho de camiseta esgotado para este evento");
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
