import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/coupons/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeGetRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons") as any;
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = { code: "PROMO10", discountType: "PERCENT", discountValue: 10 };

describe("GET /api/events/[id]/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão (rota deixou de ser pública)", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(makeGetRequest(), makeContext("ev-1"));
    expect(res.status).toBe(401);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("retorna 403 para quem não tem a permissão nem é titular", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeGetRequest(), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("organizador titular vê cupons do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([{ id: "c1", code: "PROMO10" }]);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest(), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular vê cupons de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão vê os cupons", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão vê cupons de qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-9"));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/[id]/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria cupom no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c1", ...validBody });

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("organizador titular recebe 404 ao tentar criar cupom em evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("admin titular recebe 404 (SEM bypass — coupons.create não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão cria cupom no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c2", ...validBody });

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });

  it("H1 — rejeita cupom PERCENT com valor > 100", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await POST(
      makePostRequest({ code: "PROMO101", discountType: "PERCENT", discountValue: 101 }),
      makeContext("ev-1"),
    );

    expect(res.status).toBe(400);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("H1 — rejeita desconto não-inteiro", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await POST(
      makePostRequest({ code: "PROMOHALF", discountType: "PERCENT", discountValue: 10.5 }),
      makeContext("ev-1"),
    );

    expect(res.status).toBe(400);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });
});
