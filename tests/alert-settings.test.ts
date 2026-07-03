import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { getSetting } from "@/lib/settings";
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
} from "@/lib/alerts/alert-settings";

const getSettingMock = vi.mocked(getSetting);

describe("alert-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getLowStockAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getLowStockAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false, thresholdPercent: 90 });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_low_stock_email_enabled") return "true";
        if (key === "alert_low_stock_whatsapp_enabled") return "true";
        if (key === "alert_low_stock_threshold_percent") return "80";
        return null;
      });
      const result = await getLowStockAlertSettings();
      expect(result).toEqual({ emailEnabled: true, whatsappEnabled: true, thresholdPercent: 80 });
    });
  });

  describe("getAbandonedCartAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getAbandonedCartAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_abandoned_cart_email_enabled") return "true";
        if (key === "alert_abandoned_cart_minutes") return "45";
        return null;
      });
      const result = await getAbandonedCartAlertSettings();
      expect(result).toEqual({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 45 });
    });
  });

  describe("getPaymentErrorAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getPaymentErrorAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_payment_error_whatsapp_enabled") return "true";
        return null;
      });
      const result = await getPaymentErrorAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: true });
    });
  });
});
