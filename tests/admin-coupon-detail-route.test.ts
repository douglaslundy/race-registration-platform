import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/admin/coupons/[id]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/coupons/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/admin/coupons/c1", { method: "DELETE" }) as any;
}

describe("PATCH /api/admin/coupons/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("admin titular edita qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", active: false });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão edita qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", active: false });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/coupons/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("admin titular exclui qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));
    const body = await res.json();

    expect(dbMock.coupon.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(body).toEqual({ ok: true });
  });

  it("admin titular recebe 409 ao excluir cupom já usado em pedido (regra de negócio preexistente, sem regressão)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({ id: "order-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(409);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exclui qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(403);
  });
});
