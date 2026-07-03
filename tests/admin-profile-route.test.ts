import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/admin/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("admin profile api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("retorna o telefone do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511999999999" });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({ profile: { phone: "5511999999999" } });
    });
  });

  describe("PUT", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await PUT(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(403);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza o telefone do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.update.mockResolvedValueOnce({ phone: "5511999999999" });

      const res = await PUT(makeRequest({ phone: "5511999999999" }));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        data: { phone: "5511999999999" },
        select: { phone: true },
      });
      expect(body).toEqual({ profile: { phone: "5511999999999" } });
    });
  });
});
