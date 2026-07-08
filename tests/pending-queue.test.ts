import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";

const dbMock = db as any;

describe("listPendingCancellations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem organizerUserId, busca CANCELLATION_REQUESTED em todos os eventos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await listPendingCancellations();

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "CANCELLATION_REQUESTED" } }),
    );
  });

  it("com organizerUserId, escopa por eventos daquele organizador", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await listPendingCancellations("org-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "CANCELLATION_REQUESTED", event: { organizer: { userId: "org-1" } } },
      }),
    );
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
