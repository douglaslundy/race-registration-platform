import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/settings/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin settings api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("updates a setting and writes an audit log", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ key: "app_name", value: "Old Name" });
    dbMock.platformSetting.upsert.mockResolvedValueOnce({ key: "app_name", value: "New Name" });

    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "app_name", value: "New Name" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "app_name" },
        create: { key: "app_name", value: "New Name" },
        update: { value: "New Name" },
      }),
    );
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SETTING_UPDATED",
          entityType: "PlatformSetting",
          entityId: "app_name",
        }),
      }),
    );
  });
});
