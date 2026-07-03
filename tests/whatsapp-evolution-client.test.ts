import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  sendTextMessage,
} from "@/lib/whatsapp/evolution-client";

const config = { apiUrl: "https://evo.example.com", apiKey: "test-key", instanceName: "corridas-app" };

describe("evolution-client", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe("createInstance", () => {
    it("faz POST em /instance/create com o nome da instância e retorna o QR code", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 201,
        json: async () => ({
          instance: { instanceName: "corridas-app", status: "created" },
          qrcode: { base64: "data:image/png;base64,AAA" },
        }),
      });

      const result = await createInstance(config);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/create",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ apikey: "test-key", "Content-Type": "application/json" }),
          body: JSON.stringify({ instanceName: "corridas-app", integration: "WHATSAPP-BAILEYS", qrcode: true }),
        }),
      );
      expect(result).toEqual({ qrCodeBase64: "data:image/png;base64,AAA" });
    });

    it("lança erro quando a Evolution API retorna status de erro", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 500, json: async () => ({ error: "boom" }) });
      await expect(createInstance(config)).rejects.toThrow("Evolution API 500");
    });
  });

  describe("getQrCode", () => {
    it("busca o QR code em /instance/connect/{instance}, tratando o campo qrcode como string", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        json: async () => ({ qrcode: "data:image/png;base64,BBB" }),
      });

      const result = await getQrCode(config);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/connect/corridas-app",
        expect.objectContaining({ method: "GET", headers: expect.objectContaining({ apikey: "test-key" }) }),
      );
      expect(result).toEqual({ qrCodeBase64: "data:image/png;base64,BBB" });
    });
  });

  describe("getConnectionState", () => {
    it("retorna 'open' quando instance.state é open", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({ instance: { state: "open" } }) });
      expect(await getConnectionState(config)).toBe("open");
    });

    it("retorna 'not_found' em um 404", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      expect(await getConnectionState(config)).toBe("not_found");
    });

    it("lança erro em outros status de erro", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 500, json: async () => ({}) });
      await expect(getConnectionState(config)).rejects.toThrow("Evolution API 500");
    });
  });

  describe("logoutInstance", () => {
    it("faz POST em /instance/logout/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      await logoutInstance(config);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/logout/corridas-app",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("não lança erro em um 404 (já desconectado)", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      await expect(logoutInstance(config)).resolves.toBeUndefined();
    });
  });

  describe("deleteInstance", () => {
    it("faz DELETE em /instance/delete/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      await deleteInstance(config);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/delete/corridas-app",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("não lança erro em um 404 (instância já não existe)", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      await expect(deleteInstance(config)).resolves.toBeUndefined();
    });
  });

  describe("sendTextMessage", () => {
    it("envia o telefone e o texto para /message/sendText/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({ key: { id: "abc" } }) });
      await sendTextMessage(config, "5511999999999", "Olá!");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/message/sendText/corridas-app",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ number: "5511999999999", text: "Olá!" }),
        }),
      );
    });

    it("lança erro quando o envio falha", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 400, json: async () => ({ error: "invalid number" }) });
      await expect(sendTextMessage(config, "invalid", "Olá!")).rejects.toThrow("Evolution API 400");
    });
  });
});
