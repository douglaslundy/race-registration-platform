import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/ads/private-ad-metrics", () => ({ recordClick: vi.fn() }));
vi.mock("@/lib/ads/abuse-guard", () => ({ shouldCountAdClick: vi.fn(() => true) }));

import { GET } from "@/app/api/ads/click/[privateAdId]/route";
import { recordClick } from "@/lib/ads/private-ad-metrics";
import { shouldCountAdClick } from "@/lib/ads/abuse-guard";

const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/ads/click/ad-1") as any;
}

describe("GET /api/ads/click/[privateAdId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redireciona pra targetUrl e registra o clique quando o anúncio existe e está aprovado", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1", targetUrl: "https://empresa.com", status: "APPROVED" });

    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });

    expect(recordClick).toHaveBeenCalledWith("slot-1", "PRIVATE");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://empresa.com");
  });

  it("retorna 404 quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("M7 — redireciona mas NÃO registra clique quando shouldCountAdClick é falso (prefetch/dedupe)", async () => {
    vi.mocked(shouldCountAdClick).mockReturnValueOnce(false);
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1", targetUrl: "https://empresa.com", status: "APPROVED" });

    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });

    expect(res.status).toBe(307);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio existe mas não está mais aprovado", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1", targetUrl: "https://empresa.com", status: "EXPIRED" });
    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });
});
