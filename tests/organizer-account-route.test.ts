import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/organizer/account/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/account", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("organizer account api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  describe("GET", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("retorna nome, telefone e cpf do organizador autenticado", async () => {
      dbMock.user.findUnique.mockResolvedValueOnce({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({ profile: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });

  describe("PUT", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await PUT(makeRequest({ name: "Organizador" }));
      expect(res.status).toBe(401);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      const res = await PUT(makeRequest({ name: "" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone e cpf do organizador autenticado", async () => {
      dbMock.user.update.mockResolvedValueOnce({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await PUT(makeRequest({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" }));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" },
        select: { name: true, phone: true, cpf: true },
      });
      expect(body).toEqual({ profile: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });
});
