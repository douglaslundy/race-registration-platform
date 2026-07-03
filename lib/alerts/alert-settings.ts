import { getSetting } from "../settings";

export interface LowStockAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  thresholdPercent: number;
}

export interface AbandonedCartAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  minutesThreshold: number;
}

export interface PaymentErrorAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getLowStockAlertSettings(): Promise<LowStockAlertSettings> {
  const [emailEnabled, whatsappEnabled, thresholdPercent] = await Promise.all([
    getSetting("alert_low_stock_email_enabled"),
    getSetting("alert_low_stock_whatsapp_enabled"),
    getSetting("alert_low_stock_threshold_percent"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    thresholdPercent: thresholdPercent ? parseInt(thresholdPercent, 10) : 90,
  };
}

export async function getAbandonedCartAlertSettings(): Promise<AbandonedCartAlertSettings> {
  const [emailEnabled, whatsappEnabled, minutesThreshold] = await Promise.all([
    getSetting("alert_abandoned_cart_email_enabled"),
    getSetting("alert_abandoned_cart_whatsapp_enabled"),
    getSetting("alert_abandoned_cart_minutes"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    minutesThreshold: minutesThreshold ? parseInt(minutesThreshold, 10) : 30,
  };
}

export async function getPaymentErrorAlertSettings(): Promise<PaymentErrorAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_payment_error_email_enabled"),
    getSetting("alert_payment_error_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}
