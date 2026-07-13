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

const validBody = {
  name: "Admin",
  phone: "5511999999999",
  cpf: "123.456.789-00",
  dailySummaryEmailEnabled: true,
  dailySummaryWhatsappEnabled: false,
};

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

    it("retorna nome, telefone, cpf e preferências de resumo diário do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.findUnique.mockResolvedValueOnce({
        name: "Admin",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({
        profile: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
    });
  });

  describe("PUT", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await PUT(makeRequest(validBody));
      expect(res.status).toBe(403);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await PUT(makeRequest({ ...validBody, name: "" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando as preferências de resumo diário estão ausentes", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const { dailySummaryEmailEnabled: _omit, ...bodyWithoutToggle } = validBody;
      const res = await PUT(makeRequest(bodyWithoutToggle));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone, cpf e preferências de resumo diário do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.update.mockResolvedValueOnce({
        name: "Admin",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: false,
      });

      const res = await PUT(makeRequest(validBody));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        data: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
        select: {
          name: true,
          phone: true,
          cpf: true,
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
      expect(body).toEqual({
        profile: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
      });
    });
  });
});
