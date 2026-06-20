import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/banners/route";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("events banners api", () => {
  it("falls back to listBannerUrl when bannerUrl is missing", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([
      {
        id: "event-1",
        title: "Corrida da Serra",
        slug: "corrida-da-serra",
        bannerUrl: null,
        listBannerUrl: "https://cdn.example.com/list-banner.webp",
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual([
      expect.objectContaining({
        slug: "corrida-da-serra",
        bannerUrl: "https://cdn.example.com/list-banner.webp",
        listBannerUrl: "https://cdn.example.com/list-banner.webp",
      }),
    ]);
  });
});
