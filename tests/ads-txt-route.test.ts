import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { GET } from "@/app/ads.txt/route";
import { getSetting } from "@/lib/settings";

describe("GET /ads.txt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 404 quando não há client ID do AdSense configurado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("retorna a linha do ads.txt com o publisher ID derivado do client ID", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("ca-pub-6911820306119064");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe("google.com, pub-6911820306119064, DIRECT, f08c47fec0942fa0\n");
  });
});
