import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFileViaPresign } from "@/lib/upload-client";

describe("upload client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a presigned url and uploads the file with PUT", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://storage.example.com/upload",
          fileUrl: "https://cdn.example.com/banner.webp",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      });

    vi.stubGlobal("fetch", fetchMock as any);

    const file = new File(["abc"], "banner.webp", { type: "image/webp" });

    const fileUrl = await uploadFileViaPresign(file, "banner");

    expect(fileUrl).toBe("https://cdn.example.com/banner.webp");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/upload/presign",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "banner", mimeType: "image/webp", size: 3 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://storage.example.com/upload",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
      }),
    );
  });
});
