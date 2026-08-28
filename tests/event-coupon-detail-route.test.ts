import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/coupons/[couponId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, couponId: string) {
  return { params: Promise.resolve({ id, couponId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/coupons/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons/c1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/coupons/[couponId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));
    expect(res.status).toBe(401);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("admin titular recebe 404 (SEM bypass — coupons.edit não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-9", "c9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita cupom do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", maxUses: 5 });

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(dbMock.coupon.findFirst).toHaveBeenCalledWith({ where: { id: "c1", eventId: "ev-1" } });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 ao tentar editar cupom de outro evento (fix do IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão edita o cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", maxUses: 5 });

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/coupons/[couponId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));
    expect(res.status).toBe(401);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("admin titular recebe 404 (SEM bypass — coupons.delete não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-9", "c9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui cupom do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));
    const body = await res.json();

    expect(dbMock.coupon.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(body).toEqual({ success: true });
  });

  it("organizador titular recebe 409 ao tentar excluir cupom já usado em pedido", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.order.findFirst.mockResolvedValueOnce({ id: "order-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));

    expect(res.status).toBe(409);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("organizador titular recebe 404 ao tentar excluir cupom de outro evento (fix do IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão exclui o cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));

    expect(res.status).toBe(403);
  });
});
