import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

const dbMock = db as any;

import { buildAbandonedCartWhere, buildAbandonedCartOrderBy, listAbandonedCarts } from "@/lib/alerts/abandoned-cart-query";

describe("buildAbandonedCartWhere", () => {
  it("sempre filtra status PENDING", () => {
    const where = buildAbandonedCartWhere({});
    expect(where).toEqual({ AND: [{ status: "PENDING" }] });
  });

  it("adiciona escopo de organizador quando informado", () => {
    const where = buildAbandonedCartWhere({}, { organizerUserId: "org-user-1" });
    expect(where).toEqual({
      AND: [{ status: "PENDING" }, { event: { organizer: { userId: "org-user-1" } } }],
    });
  });

  it("filtra por busca (q) em comprador ou evento", () => {
    const where = buildAbandonedCartWhere({ q: "maria" });
    expect(where).toEqual({
      AND: [
        { status: "PENDING" },
        {
          OR: [
            { buyer: { name: { contains: "maria", mode: "insensitive" } } },
            { buyer: { email: { contains: "maria", mode: "insensitive" } } },
            { event: { title: { contains: "maria", mode: "insensitive" } } },
          ],
        },
      ],
    });
  });
});

describe("buildAbandonedCartOrderBy", () => {
  it("ordena por createdAt desc por padrão", () => {
    expect(buildAbandonedCartOrderBy("", "")).toEqual({
      orderBy: [{ createdAt: "desc" }],
      normalizedSort: "createdAt",
      normalizedDir: "desc",
    });
  });

  it("ordena por valor (amount) quando pedido", () => {
    expect(buildAbandonedCartOrderBy("amount", "asc")).toEqual({
      orderBy: [{ subtotalAmount: "asc" }, { createdAt: "desc" }],
      normalizedSort: "amount",
      normalizedDir: "asc",
    });
  });
});

describe("listAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("junta o último AlertLog de cada pedido nas linhas retornadas", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([
      {
        id: "order-1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        subtotalAmount: 5000,
        event: { title: "Corrida X" },
        buyer: { name: "Maria", email: "maria@example.com", athleteProfile: { phone: "5511999999999" } },
      },
    ]);
    dbMock.order.count.mockResolvedValueOnce(1);
    dbMock.alertLog.findMany.mockResolvedValueOnce([
      { entityId: "order-1", sentAt: new Date("2026-07-02T00:00:00Z") },
    ]);

    const result = await listAbandonedCarts({ AND: [{ status: "PENDING" }] }, [{ createdAt: "desc" }], 0, 20);

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      {
        id: "order-1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        subtotalAmount: 5000,
        eventTitle: "Corrida X",
        buyerName: "Maria",
        buyerEmail: "maria@example.com",
        hasPhone: true,
        lastAlertSentAt: new Date("2026-07-02T00:00:00Z"),
      },
    ]);
  });

  it("não consulta AlertLog quando não há pedidos", async () => {
    dbMock.order.findMany.mockResolvedValueOnce([]);
    dbMock.order.count.mockResolvedValueOnce(0);

    const result = await listAbandonedCarts({ AND: [{ status: "PENDING" }] }, [{ createdAt: "desc" }], 0, 20);

    expect(dbMock.alertLog.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], total: 0 });
  });
});
