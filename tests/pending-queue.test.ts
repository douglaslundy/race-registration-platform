import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";

const dbMock = db as any;

describe("listPendingCancellations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem organizerUserId, busca CANCELLATION_REQUESTED em todos os eventos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        createdAt: new Date(),
        cancellationReason: null,
        cancellationRequestedAt: new Date(),
        athlete: { name: "Atleta", email: "atleta@example.com" },
        event: { id: "event-1", title: "Corrida" },
        order: { payments: [{ id: "payment-1" }] },
      },
    ]);

    const result = await listPendingCancellations();

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "CANCELLATION_REQUESTED" },
        select: expect.objectContaining({
          order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } },
        }),
      }),
    );
    expect(result[0].hasPaidPayment).toBe(true);
  });

  it("com organizerUserId, escopa por eventos daquele organizador", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-2",
        createdAt: new Date(),
        cancellationReason: null,
        cancellationRequestedAt: new Date(),
        athlete: { name: "Atleta", email: "atleta@example.com" },
        event: { id: "event-1", title: "Corrida" },
        order: { payments: [] },
      },
    ]);

    const result = await listPendingCancellations("org-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "CANCELLATION_REQUESTED", event: { organizer: { userId: "org-1" } } },
      }),
    );
    expect(result[0].hasPaidPayment).toBe(false);
  });
});

describe("listPendingRefunds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem organizerUserId, busca Payment REFUND_PENDING em todos os eventos", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await listPendingRefunds();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "REFUND_PENDING" } }),
    );
  });

  it("com organizerUserId, escopa por eventos daquele organizador", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    await listPendingRefunds("org-1");

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "REFUND_PENDING", order: { event: { organizer: { userId: "org-1" } } } },
      }),
    );
  });
});
