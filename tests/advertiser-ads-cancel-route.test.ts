import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/anunciante/ads/[id]/cancel/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/anunciante/ads/ad-1/cancel", { method: "POST" }) as any;
}

function makeParams(id = "ad-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/anunciante/ads/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando o usuário ADVERTISER não tem AdvertiserProfile", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não pertence ao anunciante autenticado (IDOR), sem vazar existência", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(dbMock.privateAd.findFirst).toHaveBeenCalledWith({
      where: { id: "ad-1", adPurchase: { advertiserId: "advertiser-1" } },
      select: { id: true, status: true },
    });
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 409 quando o anúncio já não está mais ativo (ex.: já expirado)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "EXPIRED" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(409);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("cancela um anúncio PENDING_APPROVAL e retorna 200", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "PENDING_APPROVAL" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "CANCELLED" },
    });
  });

  it("cancela um anúncio APPROVED e retorna 200", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "CANCELLED" },
    });
  });
});
