import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));

vi.mock("@/lib/whatsapp/evolution-client", () => ({
  createInstance: vi.fn(),
  getQrCode: vi.fn(),
  getConnectionState: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
}));

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { POST as instancePost } from "@/app/api/admin/whatsapp/instance/route";
import { GET as statusGet } from "@/app/api/admin/whatsapp/status/route";
import { POST as disconnectPost } from "@/app/api/admin/whatsapp/disconnect/route";
import { POST as deletePost } from "@/app/api/admin/whatsapp/delete/route";
import { POST as testPost } from "@/app/api/admin/whatsapp/test/route";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  setWebhook,
} from "@/lib/whatsapp/evolution-client";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const configMock = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/whatsapp/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as any;
}

describe("admin whatsapp routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(configMock);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
  });

  describe("POST /api/admin/whatsapp/instance", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await instancePost();
      expect(res.status).toBe(403);
    });

    it("retorna 400 quando não está configurado", async () => {
      vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
      const res = await instancePost();
      expect(res.status).toBe(400);
      expect(getConnectionState).not.toHaveBeenCalled();
    });

    it("cria a instância e grava auditoria quando ela ainda não existe", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("not_found");
      vi.mocked(createInstance).mockResolvedValueOnce({ qrCodeBase64: "data:image/png;base64,AAA" });

      const res = await instancePost();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.qrCodeBase64).toBe("data:image/png;base64,AAA");
      expect(createInstance).toHaveBeenCalledWith(configMock);
      expect(getQrCode).not.toHaveBeenCalled();
      expect(dbMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "WHATSAPP_INSTANCE_CREATED" }) }),
      );
    });

    it("atualiza o QR code sem criar uma nova instância quando ela já existe", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("close");
      vi.mocked(getQrCode).mockResolvedValueOnce({ qrCodeBase64: "data:image/png;base64,BBB" });

      const res = await instancePost();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.qrCodeBase64).toBe("data:image/png;base64,BBB");
      expect(createInstance).not.toHaveBeenCalled();
      expect(dbMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("retorna 502 quando a chamada à Evolution API falha", async () => {
      vi.mocked(getConnectionState).mockRejectedValueOnce(new Error("Evolution API 500: boom"));
      const res = await instancePost();
      expect(res.status).toBe(502);
    });
  });

  describe("GET /api/admin/whatsapp/status", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await statusGet();
      expect(res.status).toBe(403);
    });

    it("retorna not_configured sem chamar o cliente quando faltam credenciais", async () => {
      vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("not_configured");
      expect(getConnectionState).not.toHaveBeenCalled();
    });

    it("retorna o estado de conexão quando configurado", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("open");
    });

    it("registra o webhook quando o estado é open e as env vars estão presentes", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      await statusGet();

      expect(setWebhook).toHaveBeenCalledWith(
        configMock,
        "https://app.example.com/api/webhooks/whatsapp?secret=shh",
      );
    });

    it("não registra o webhook quando o estado não é open", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("connecting");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      await statusGet();

      expect(setWebhook).not.toHaveBeenCalled();
    });

    it("não registra o webhook quando falta a env var do segredo, mas ainda retorna o estado normalmente", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      delete process.env.WHATSAPP_WEBHOOK_SECRET;
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      const res = await statusGet();

      expect(setWebhook).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("uma falha ao registrar o webhook não quebra a resposta de status", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      vi.mocked(setWebhook).mockRejectedValueOnce(new Error("Evolution API 500"));

      const res = await statusGet();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.state).toBe("open");
    });
  });

  describe("POST /api/admin/whatsapp/disconnect", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await disconnectPost();
      expect(res.status).toBe(403);
    });

    it("chama logoutInstance e retorna ok", async () => {
      const res = await disconnectPost();
      expect(res.status).toBe(200);
      expect(logoutInstance).toHaveBeenCalledWith(configMock);
    });
  });

  describe("POST /api/admin/whatsapp/delete", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await deletePost();
      expect(res.status).toBe(403);
    });

    it("chama deleteInstance e grava auditoria", async () => {
      const res = await deletePost();
      expect(res.status).toBe(200);
      expect(deleteInstance).toHaveBeenCalledWith(configMock);
      expect(dbMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "WHATSAPP_INSTANCE_DELETED" }) }),
      );
    });

    it("desloga (best-effort) antes de excluir -- a Evolution API rejeita exclusão de instância ainda conectada", async () => {
      await deletePost();
      expect(logoutInstance).toHaveBeenCalledWith(configMock);
      expect(deleteInstance).toHaveBeenCalledWith(configMock);
    });

    it("segue tentando excluir mesmo se o logout falhar (ex.: já estava desconectada)", async () => {
      vi.mocked(logoutInstance).mockRejectedValueOnce(new Error("já desconectada"));
      const res = await deletePost();
      expect(res.status).toBe(200);
      expect(deleteInstance).toHaveBeenCalledWith(configMock);
    });
  });

  describe("POST /api/admin/whatsapp/test", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(403);
    });

    it("retorna 400 para um telefone inválido", async () => {
      const res = await testPost(makeRequest({ phone: "123" }));
      expect(res.status).toBe(400);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("envia a mensagem de teste e retorna ok", async () => {
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.to).toBe("5511999999999");
      expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    });

    it("retorna 502 quando o envio falha", async () => {
      vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp não configurado"));
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(502);
    });
  });
});
