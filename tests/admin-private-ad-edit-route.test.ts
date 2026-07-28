import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/admin/ads/private/[id]/route";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/ads/private/ad-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/admin/ads/private/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.auditLog.create.mockResolvedValue({});
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 com URL inválida", async () => {
    const res = await PATCH(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(404);
  });

  it("atualiza o link sem mudar o status (admin é quem modera)", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED", targetUrl: "https://empresa.com/antiga" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova" },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "PRIVATE_AD_LINK_UPDATED",
        entityType: "PrivateAd",
        entityId: "ad-1",
        metadata: {
          oldTargetUrl: "https://empresa.com/antiga",
          newTargetUrl: "https://empresa.com/nova",
          editedByAdmin: true,
        },
      },
    });
  });
});
