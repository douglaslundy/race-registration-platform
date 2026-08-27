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

  it("aceita pix_service_fee_discount_percent inteiro entre 0 e 100", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);
    dbMock.platformSetting.upsert.mockResolvedValueOnce({ key: "pix_service_fee_discount_percent", value: "20" });

    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: "20" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.platformSetting.upsert).toHaveBeenCalled();
  });

  it("persiste o inteiro normalizado de pix_service_fee_discount_percent (ex.: '1e2' -> '100')", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);
    dbMock.platformSetting.upsert.mockResolvedValueOnce({ key: "pix_service_fee_discount_percent", value: "100" });

    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: "1e2" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { key: "pix_service_fee_discount_percent", value: "100" },
        update: { value: "100" },
      }),
    );
  });

  it("rejeita pix_service_fee_discount_percent negativo", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: "-5" }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejeita pix_service_fee_discount_percent acima de 100", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: "150" }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejeita pix_service_fee_discount_percent não inteiro", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: "12.5" }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });
});
