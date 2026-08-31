import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/ads/private-ad-metrics", () => ({ recordClick: vi.fn() }));
vi.mock("@/lib/ads/abuse-guard", () => ({ shouldCountAdClick: vi.fn(() => true) }));

import { GET } from "@/app/api/ads/click/house/[slotId]/route";
import { recordClick } from "@/lib/ads/private-ad-metrics";
import { shouldCountAdClick } from "@/lib/ads/abuse-guard";

const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/ads/click/house/slot-1") as any;
}

describe("GET /api/ads/click/house/[slotId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redireciona pra houseAdTargetUrl e registra o clique quando o slot é HOUSE e está configurado", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      id: "slot-1",
      source: "HOUSE",
      houseAdTargetUrl: "https://empresa.com",
    });

    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });

    expect(recordClick).toHaveBeenCalledWith("slot-1", "HOUSE");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://empresa.com");
  });

  it("M7 — redireciona sem registrar clique quando shouldCountAdClick é falso", async () => {
    vi.mocked(shouldCountAdClick).mockReturnValueOnce(false);
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ id: "slot-1", source: "HOUSE", houseAdTargetUrl: "https://empresa.com" });

    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });

    expect(res.status).toBe(307);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o slot não existe", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o slot existe mas a fonte não é mais HOUSE", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      id: "slot-1",
      source: "GOOGLE",
      houseAdTargetUrl: "https://empresa.com",
    });
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o slot é HOUSE mas não tem houseAdTargetUrl configurado", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ id: "slot-1", source: "HOUSE", houseAdTargetUrl: null });
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });
});
