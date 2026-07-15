import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/abandoned-cart", () => ({ sendAbandonedCartAlert: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getAbandonedCartAlertSettings: vi.fn() }));

import { POST } from "@/app/api/organizer/abandoned-carts/notify/route";
import { auth } from "@/lib/auth";
import { sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  buyerUserId: "athlete-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/abandoned-carts/notify", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/abandoned-carts/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({
      emailEnabled: true,
      whatsappEnabled: true,
      minutesThreshold: 30,
    });
  });

  it("retorna 403 quando não é organizador nem admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ orderId: "order-1" }));
    expect(res.status).toBe(403);
  });

  it("busca o pedido individual escopado ao organizador autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    await POST(makeRequest({ orderId: "order-1" }));

    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: { id: "order-1", status: "PENDING", event: { organizer: { userId: "org-user-1" } } },
      select: expect.any(Object),
    });
  });

  it("retorna 404 quando pedido individual não é encontrado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ orderId: "order-1" }));
    expect(res.status).toBe(404);
  });

  it("envia notificação para pedido individual quando sent: true", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(body).toEqual({ notified: 1, total: 1 });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "org-user-1",
        action: "ABANDONED_CART_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: "order-1",
        metadata: { eventTitle: "Corrida Teste" },
      },
    });
  });

  it("não incrementa notified quando sent: false", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: false });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(body).toEqual({ notified: 0, total: 1 });
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("envia em massa escopado ao organizador autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ all: true }));
    const body = await res.json();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ event: { organizer: { userId: "org-user-1" } } }]),
        }),
      }),
    );
    expect(body).toEqual({ notified: 1, total: 1 });
    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("continua loop em massa quando uma ordem falha e retorna total preciso", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const order2 = { ...orderFixture, id: "order-2" };
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture, order2]);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert)
      .mockResolvedValueOnce({ sent: true }) // order-1 succeeds
      .mockRejectedValueOnce(new Error("SendGrid error")); // order-2 fails

    const res = await POST(makeRequest({ all: true }));
    const body = await res.json();

    expect(body).toEqual({ notified: 1, total: 2 });
    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(1); // only for order-1
  });

  it("permite admin acessar e envia em massa para todos os eventos", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ all: true }));
    const body = await res.json();

    // Admin hitting organizer route should still scope by admin's userId (matching convention)
    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ event: { organizer: { userId: "admin-1" } } }]),
        }),
      }),
    );
    expect(body).toEqual({ notified: 1, total: 1 });
  });

  it("retorna 400 quando nem orderId nem all são informados", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("assistente de organizador com a permissão notifica escopado ao userId do criador", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: { id: "order-1", status: "PENDING", event: { organizer: { userId: "org-user-1" } } },
      select: expect.any(Object),
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "assistant-1" }),
    });
    expect(body).toEqual({ notified: 1, total: 1 });
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ orderId: "order-1" }));

    expect(res.status).toBe(403);
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });
});
