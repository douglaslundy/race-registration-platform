import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { claimAlert, recordAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

describe("alert dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("claimAlert", () => {
    it("retorna true e grava o registro quando ninguém reivindicou ainda", async () => {
      dbMock.alertLog.create.mockResolvedValueOnce({ id: "log-1" });

      const result = await claimAlert("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");

      expect(result).toBe(true);
      expect(dbMock.alertLog.create).toHaveBeenCalledWith({
        data: { alertType: "LOW_STOCK", entityType: "TicketBatch", entityId: "batch-1", channel: "EMAIL" },
      });
    });

    it("retorna false quando o alerta já foi reivindicado/enviado (violação de unicidade)", async () => {
      dbMock.alertLog.create.mockRejectedValueOnce({ code: "P2002" });

      const result = await claimAlert("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");

      expect(result).toBe(false);
    });

    it("propaga outros erros que não sejam violação de unicidade", async () => {
      dbMock.alertLog.create.mockRejectedValueOnce(new Error("conexão perdida"));

      await expect(claimAlert("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL")).rejects.toThrow("conexão perdida");
    });
  });

  describe("unclaimAlert", () => {
    it("remove o registro reivindicado", async () => {
      await unclaimAlert("LOW_STOCK", "batch-1", "EMAIL");

      expect(dbMock.alertLog.deleteMany).toHaveBeenCalledWith({
        where: { alertType: "LOW_STOCK", entityId: "batch-1", channel: "EMAIL" },
      });
    });
  });

  describe("recordAlert", () => {
    it("cria o registro quando nenhum existe ainda", async () => {
      dbMock.alertLog.upsert.mockResolvedValueOnce({ id: "log-1" });

      await recordAlert("ABANDONED_CART", "Order", "order-1", "EMAIL");

      expect(dbMock.alertLog.upsert).toHaveBeenCalledWith({
        where: { alertType_entityId_channel: { alertType: "ABANDONED_CART", entityId: "order-1", channel: "EMAIL" } },
        create: { alertType: "ABANDONED_CART", entityType: "Order", entityId: "order-1", channel: "EMAIL" },
        update: { sentAt: expect.any(Date) },
      });
    });

    it("atualiza o sentAt quando o registro já existe", async () => {
      dbMock.alertLog.upsert.mockResolvedValueOnce({ id: "log-1", sentAt: new Date() });

      await recordAlert("ABANDONED_CART", "Order", "order-1", "WHATSAPP");

      expect(dbMock.alertLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { alertType_entityId_channel: { alertType: "ABANDONED_CART", entityId: "order-1", channel: "WHATSAPP" } },
          update: { sentAt: expect.any(Date) },
        }),
      );
    });
  });
});
