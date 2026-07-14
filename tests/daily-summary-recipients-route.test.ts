import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/daily-summary-recipients/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/daily-summary-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("daily summary recipients api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 401 sem sessão", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("retorna 403 para papel que não é admin nem organizador", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("lista os destinatários do usuário autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
        { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      ]);

      const res = await GET();
      const body = await res.json();

      expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith({
        where: { userId: "admin-1" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipients: [{ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" }] });
    });
  });

  describe("POST", () => {
    it("retorna 401 sem sessão", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(401);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 403 para papel que não é admin nem organizador", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(403);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o e-mail é inválido", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "não-é-email" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o telefone tem menos de 10 dígitos", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "João", type: "WHATSAPP", value: "119999" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("cria um destinatário de e-mail com sucesso", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({
        id: "r1",
        name: "Maria",
        type: "EMAIL",
        value: "maria@example.com",
      });

      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
        data: { userId: "admin-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipient: { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" } });
    });

    it("cria um destinatário de whatsapp removendo formatação e salvando só os dígitos, sem +55", async () => {
      authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
      dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({
        id: "r2",
        name: "João",
        type: "WHATSAPP",
        value: "11999999999",
      });

      const res = await POST(makeRequest({ name: "João", type: "WHATSAPP", value: "(11) 99999-9999" }));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
        data: { userId: "org-1", name: "João", type: "WHATSAPP", value: "11999999999" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipient: { id: "r2", name: "João", type: "WHATSAPP", value: "11999999999" } });
    });
  });
});
