import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

describe("alert dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasAlertBeenSent", () => {
    it("retorna false quando não há registro em AlertLog", async () => {
      dbMock.alertLog.findUnique.mockResolvedValueOnce(null);
      const result = await hasAlertBeenSent("LOW_STOCK", "batch-1", "EMAIL");
      expect(result).toBe(false);
      expect(dbMock.alertLog.findUnique).toHaveBeenCalledWith({
        where: { alertType_entityId_channel: { alertType: "LOW_STOCK", entityId: "batch-1", channel: "EMAIL" } },
      });
    });

    it("retorna true quando já existe um registro", async () => {
      dbMock.alertLog.findUnique.mockResolvedValueOnce({ id: "log-1" });
      const result = await hasAlertBeenSent("LOW_STOCK", "batch-1", "EMAIL");
      expect(result).toBe(true);
    });
  });

  describe("markAlertSent", () => {
    it("grava um novo registro em AlertLog", async () => {
      await markAlertSent("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");
      expect(dbMock.alertLog.create).toHaveBeenCalledWith({
        data: { alertType: "LOW_STOCK", entityType: "TicketBatch", entityId: "batch-1", channel: "EMAIL" },
      });
    });
  });
});
