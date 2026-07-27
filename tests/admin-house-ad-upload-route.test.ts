import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ads/private-ads", () => ({
  validateImageDimensions: vi.fn(),
}));
vi.mock("@/lib/ad-slots", () => ({ updateAdSlot: vi.fn() }));

import { POST } from "@/app/api/admin/ads/slots/[id]/house-ad/route";
import { validateImageDimensions } from "@/lib/ads/private-ads";
import { updateAdSlot } from "@/lib/ad-slots";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const validateImageDimensionsMock = vi.mocked(validateImageDimensions);
const updateAdSlotMock = vi.mocked(updateAdSlot);

const SLOT = { id: "slot-1", key: "A", label: "Posição A", width: 300, height: 250 };

function makeRequest(fields: Record<string, string | Blob> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string | Blob> = {
    targetUrl: "https://empresa.com",
    image: new File(["fake-image-bytes"], "ad.png", { type: "image/png" }),
  };
  const merged = { ...defaults, ...fields };
  for (const [key, value] of Object.entries(merged)) {
    if (value === "") continue; // simula campo não preenchido, igual a um form real
    formData.append(key, value as any);
  }
  return new Request("http://localhost/api/admin/ads/slots/slot-1/house-ad", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("POST /api/admin/ads/slots/[id]/house-ad", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response(null, { status: 200 })) as any;
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(403);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 com URL de destino malformada", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({ targetUrl: "não-é-url" }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(400);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a URL de destino usa http em vez de https", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(400);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("aceita cadastro sem URL de destino (link opcional)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ targetUrl: "" }), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(200);
    expect(updateAdSlotMock).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: expect.any(String),
      houseAdTargetUrl: null,
    });
  });

  it("retorna 404 quando a posição não existe", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a dimensão da imagem não bate, sem subir arquivo nem atualizar a posição", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(false);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(400);
    expect(validateImageDimensionsMock).toHaveBeenCalledWith(expect.any(Buffer), SLOT.width, SLOT.height);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 200 e atualiza a posição no caminho de sucesso", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updateAdSlotMock).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: expect.any(String),
      houseAdTargetUrl: "https://empresa.com/",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.houseAdTargetUrl).toBe("https://empresa.com/");
  });

  it("retorna 400 quando a URL de destino usa esquema não-http (ex: javascript:)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(
      makeRequest({ targetUrl: "javascript:alert(1)" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(dbMock.adSlot.findUnique).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 503 quando o storage não está configurado", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 502 quando o upload pro Supabase falha", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(502);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("apaga a imagem anterior do storage quando a posição já tinha uma (reenvio substituindo a arte)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      ...SLOT,
      houseAdImageUrl: "https://supabase.example.com/storage/v1/object/public/uploads/house-ads/old.png",
    });
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://supabase.example.com/storage/v1/object/uploads/house-ads/old.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
