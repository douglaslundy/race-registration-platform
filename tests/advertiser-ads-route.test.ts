import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ads/private-ads", () => ({
  hasAvailableSlotInPurchase: vi.fn(),
  listAvailableSlotsForAdvertiser: vi.fn(),
  validateImageDimensions: vi.fn(),
}));

import { POST } from "@/app/api/anunciante/ads/route";
import {
  hasAvailableSlotInPurchase,
  listAvailableSlotsForAdvertiser,
  validateImageDimensions,
} from "@/lib/ads/private-ads";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const hasAvailableSlotInPurchaseMock = vi.mocked(hasAvailableSlotInPurchase);
const listAvailableSlotsForAdvertiserMock = vi.mocked(listAvailableSlotsForAdvertiser);
const validateImageDimensionsMock = vi.mocked(validateImageDimensions);

const SLOT = { id: "slot-1", key: "A", label: "Posição A", width: 300, height: 250 };

function makeRequest(fields: Record<string, string | Blob> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string | Blob> = {
    adPurchaseId: "purchase-1",
    adSlotId: "slot-1",
    targetUrl: "https://example.com",
    image: new File(["fake-image-bytes"], "ad.png", { type: "image/png" }),
  };
  const merged = { ...defaults, ...fields };
  for (const [key, value] of Object.entries(merged)) {
    formData.append(key, value as any);
  }
  return new Request("http://localhost/api/anunciante/ads", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("POST /api/anunciante/ads", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response(null, { status: 200 })) as any;
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando o usuário ADVERTISER não tem AdvertiserProfile", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(404);
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a compra não pertence ao anunciante autenticado (IDOR), sem vazar existência", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.adPurchase.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Esta compra não possui vaga disponível");
    expect(dbMock.adPurchase.findFirst).toHaveBeenCalledWith({
      where: { id: "purchase-1", advertiserId: "advertiser-1", status: "PAID" },
      select: { id: true },
    });
    expect(hasAvailableSlotInPurchaseMock).not.toHaveBeenCalled();
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a compra existe mas não está PAID (ex.: REJECTED ou PENDING), mesma resposta de ownership", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    // findFirst já filtra por status: "PAID" na query, então uma compra REJECTED/PENDING
    // simplesmente não é encontrada — mesmo caminho do teste de ownership acima.
    dbMock.adPurchase.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Esta compra não possui vaga disponível");
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a compra não tem vaga disponível", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.adPurchase.findFirst.mockResolvedValueOnce({ id: "purchase-1" });
    hasAvailableSlotInPurchaseMock.mockResolvedValueOnce(false);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a posição escolhida não está disponível", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.adPurchase.findFirst.mockResolvedValueOnce({ id: "purchase-1" });
    hasAvailableSlotInPurchaseMock.mockResolvedValueOnce(true);
    listAvailableSlotsForAdvertiserMock.mockResolvedValueOnce([]);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Posição indisponível/);
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a dimensão da imagem não bate, sem subir arquivo nem criar PrivateAd", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.adPurchase.findFirst.mockResolvedValueOnce({ id: "purchase-1" });
    hasAvailableSlotInPurchaseMock.mockResolvedValueOnce(true);
    listAvailableSlotsForAdvertiserMock.mockResolvedValueOnce([SLOT] as any);
    validateImageDimensionsMock.mockResolvedValueOnce(false);

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(validateImageDimensionsMock).toHaveBeenCalledWith(expect.any(Buffer), SLOT.width, SLOT.height);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a URL de destino usa http em vez de https", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });

    const res = await POST(makeRequest({ targetUrl: "http://empresa.com" }));

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.findFirst).not.toHaveBeenCalled();
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a URL de destino usa protocolo perigoso (javascript:)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });

    const res = await POST(makeRequest({ targetUrl: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.findFirst).not.toHaveBeenCalled();
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 201 e cria o PrivateAd como PENDING_APPROVAL no caminho de sucesso", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.adPurchase.findFirst.mockResolvedValueOnce({ id: "purchase-1" });
    hasAvailableSlotInPurchaseMock.mockResolvedValueOnce(true);
    listAvailableSlotsForAdvertiserMock.mockResolvedValueOnce([SLOT] as any);
    validateImageDimensionsMock.mockResolvedValueOnce(true);
    dbMock.privateAd.create.mockResolvedValueOnce({
      id: "ad-1",
      adPurchaseId: "purchase-1",
      adSlotId: "slot-1",
      status: "PENDING_APPROVAL",
    });

    const res = await POST(makeRequest());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(dbMock.privateAd.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adPurchaseId: "purchase-1",
        adSlotId: "slot-1",
        targetUrl: "https://example.com/",
        status: "PENDING_APPROVAL",
        imageUrl: expect.any(String),
      }),
    });
    expect(res.status).toBe(201);
  });
});
