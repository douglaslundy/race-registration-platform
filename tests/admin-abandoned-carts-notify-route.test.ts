import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/abandoned-cart", () => ({ sendAbandonedCartAlert: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getAbandonedCartAlertSettings: vi.fn() }));

import { POST } from "@/app/api/admin/abandoned-carts/notify/route";
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
  return new Request("http://localhost/api/admin/abandoned-carts/notify", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/abandoned-carts/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true, minutesThreshold: 30 });
  });

  it("retorna 403 quando não é admin", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ orderId: "order-1" }));
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando o pedido não existe ou não está PENDING", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ orderId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("envia alerta individual com bypassDedupe e grava auditoria", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(sendAbandonedCartAlert).toHaveBeenCalledWith(orderFixture, expect.any(Object), { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "admin-1", action: "ABANDONED_CART_NOTIFICATION_RESENT", entityId: "order-1" }),
      }),
    );
    expect(body).toEqual({ notified: 1, total: 1 });
  });

  it("envia em massa para todos os pedidos que casam com os filtros", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture, { ...orderFixture, id: "order-2" }]);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValue({ sent: true });

    const res = await POST(makeRequest({ all: true, q: "maria" }));
    const body = await res.json();

    expect(sendAbandonedCartAlert).toHaveBeenCalledTimes(2);
    expect(dbMock.auditLog.create).toHaveBeenCalledTimes(2);
    expect(dbMock.auditLog.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ userId: "admin-1", action: "ABANDONED_CART_NOTIFICATION_RESENT", entityId: "order-1" }),
      }),
    );
    expect(dbMock.auditLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ userId: "admin-1", action: "ABANDONED_CART_NOTIFICATION_RESENT", entityId: "order-2" }),
      }),
    );
    expect(body).toEqual({ notified: 2, total: 2 });
  });

  it("retorna 400 quando não informa orderId nem all", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("não grava auditoria quando sendAbandonedCartAlert retorna sent: false", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: false });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
    expect(body).toEqual({ notified: 0, total: 1 });
  });

  it("assistente de admin com a permissão notifica qualquer pedido", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.order.findFirst.mockResolvedValueOnce(orderFixture);
    dbMock.auditLog.create.mockResolvedValueOnce({});
    vi.mocked(sendAbandonedCartAlert).mockResolvedValueOnce({ sent: true });

    const res = await POST(makeRequest({ orderId: "order-1" }));
    const body = await res.json();

    expect(body).toEqual({ notified: 1, total: 1 });
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest({ orderId: "order-1" }));

    expect(res.status).toBe(403);
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ orderId: "order-1" }));

    expect(res.status).toBe(403);
  });

  it("retorna 401 sem sessão", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);

    const res = await POST(makeRequest({ orderId: "order-1" }));

    expect(res.status).toBe(401);
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });
});
