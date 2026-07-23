import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ad-slots", () => ({ updateAdSlot: vi.fn() }));

import { PATCH } from "@/app/api/admin/ads/slots/[id]/route";
import { updateAdSlot } from "@/lib/ad-slots";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/ads/slots/slot-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/admin/ads/slots/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ enabled: true }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(403);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido (source fora do enum aceito)", async () => {
    const res = await PATCH(
      makeRequest({ source: "BING" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });

  it("atualiza a posição com payload válido e retorna 200", async () => {
    const res = await PATCH(
      makeRequest({ enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      enabled: true,
      source: "GOOGLE",
      googleAdUnitId: "1234567890",
    });
    expect(res.status).toBe(200);
  });

  it("aceita source null (desativa a fonte sem desligar a posição)", async () => {
    const res = await PATCH(
      makeRequest({ source: null, googleAdUnitId: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", { source: null, googleAdUnitId: null });
    expect(res.status).toBe(200);
  });

  it("aceita source HOUSE com houseAdImageUrl/houseAdTargetUrl", async () => {
    const res = await PATCH(
      makeRequest({
        source: "HOUSE",
        houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
        houseAdTargetUrl: "https://empresa.com",
      }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
      houseAdTargetUrl: "https://empresa.com",
    });
    expect(res.status).toBe(200);
  });

  it("aceita limpar houseAdImageUrl/houseAdTargetUrl com null ao trocar de fonte", async () => {
    const res = await PATCH(
      makeRequest({ source: "GOOGLE", houseAdImageUrl: null, houseAdTargetUrl: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      source: "GOOGLE",
      houseAdImageUrl: null,
      houseAdTargetUrl: null,
    });
    expect(res.status).toBe(200);
  });

  it("retorna 400 quando houseAdTargetUrl usa esquema não-http (ex: javascript:)", async () => {
    const res = await PATCH(
      makeRequest({ source: "HOUSE", houseAdTargetUrl: "javascript:alert(1)" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });
});
