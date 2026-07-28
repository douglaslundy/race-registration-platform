import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/anunciante/ads/[id]/route";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/anunciante/ads/ad-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/anunciante/ads/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValue({ id: "advertiser-1" });
    dbMock.auditLog.create.mockResolvedValue({});
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(401);
  });

  it("retorna 400 com URL inválida", async () => {
    const res = await PATCH(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não pertence ao anunciante autenticado", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.privateAd.findFirst).toHaveBeenCalledWith({
      where: { id: "ad-1", adPurchase: { advertiserId: "advertiser-1" } },
      select: { id: true, status: true, targetUrl: true },
    });
  });

  it("retorna 400 quando o anúncio está REJECTED/EXPIRED/CANCELLED", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "CANCELLED" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("atualiza o link sem mudar o status quando o anúncio está PENDING_APPROVAL", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "PENDING_APPROVAL", targetUrl: "https://empresa.com/antiga" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova-pagina" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova-pagina" },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        action: "PRIVATE_AD_LINK_UPDATED",
        entityType: "PrivateAd",
        entityId: "ad-1",
        metadata: {
          oldTargetUrl: "https://empresa.com/antiga",
          newTargetUrl: "https://empresa.com/nova-pagina",
          requiresReview: false,
        },
      },
    });
  });

  it("atualiza o link e volta pra PENDING_APPROVAL quando o anúncio estava APPROVED", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED", targetUrl: "https://empresa.com/antiga" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova-pagina" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova-pagina", status: "PENDING_APPROVAL", rejectionReason: null },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        action: "PRIVATE_AD_LINK_UPDATED",
        entityType: "PrivateAd",
        entityId: "ad-1",
        metadata: {
          oldTargetUrl: "https://empresa.com/antiga",
          newTargetUrl: "https://empresa.com/nova-pagina",
          requiresReview: true,
        },
      },
    });
  });
});
