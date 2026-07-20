import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => {
  const db: any = {
    privateAd: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db };
});

import { POST as approvePOST } from "@/app/api/admin/ads/private/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/admin/ads/private/[id]/reject/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/ads/private/ad-1/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/ads/private/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await approvePOST(makeRequest(), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("aprova o anúncio e retorna 200", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce(null);
    const res = await approvePOST(makeRequest(), { params: Promise.resolve({ id: "ad-1" }) });
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "APPROVED" },
    });
    expect(res.status).toBe(200);
  });

  it("retorna 404 quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    const res = await approvePOST(makeRequest(), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 409 quando outro anúncio já está aprovado na mesma posição", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-2", adSlotId: "slot-1", status: "APPROVED" });
    const res = await approvePOST(makeRequest(), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Esta posição já possui um anúncio aprovado");
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ads/private/[id]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await rejectPOST(makeRequest({ reason: "Imagem inadequada" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 400 ao rejeitar sem rejectionReason", async () => {
    const res = await rejectPOST(makeRequest({ reason: "" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("rejeita com motivo e retorna 200", async () => {
    const res = await rejectPOST(makeRequest({ reason: "Imagem inadequada" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "REJECTED", rejectionReason: "Imagem inadequada" },
    });
    expect(res.status).toBe(200);
  });
});
