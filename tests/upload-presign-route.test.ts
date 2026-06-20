import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/upload/presign/route";
import { auth } from "@/lib/auth";
import { isS3Configured, createPresignedUploadUrl } from "@/lib/s3";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/s3", () => ({
  isS3Configured: vi.fn(),
  createPresignedUploadUrl: vi.fn(),
}));

const authMock = vi.mocked(auth);
const isS3ConfiguredMock = vi.mocked(isS3Configured);
const createPresignedUploadUrlMock = vi.mocked(createPresignedUploadUrl);

describe("upload presign route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1" } } as any);
    isS3ConfiguredMock.mockResolvedValue(true);
    createPresignedUploadUrlMock.mockResolvedValue({
      url: "https://example.com/upload",
      key: "list_banner/test.webp",
      fileUrl: "https://example.com/file.webp",
    });
  });

  it("accepts list_banner uploads", async () => {
    const res = await POST(
      new Request("http://localhost/api/upload/presign", {
        method: "POST",
        body: JSON.stringify({ purpose: "list_banner", mimeType: "image/webp", size: 1024 }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(createPresignedUploadUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "list_banner", mimeType: "image/webp", extension: "webp" }),
    );
  });
});
