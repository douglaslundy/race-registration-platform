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

export interface ReconciliationAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  minutesThreshold: number;
}

export async function getReconciliationAlertSettings(): Promise<ReconciliationAlertSettings> {
  const [emailEnabled, whatsappEnabled, minutesThreshold] = await Promise.all([
    getSetting("alert_reconciliation_email_enabled"),
    getSetting("alert_reconciliation_whatsapp_enabled"),
    getSetting("alert_reconciliation_minutes_threshold"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    minutesThreshold: minutesThreshold ? parseInt(minutesThreshold, 10) : 15,
  };
}

export interface CancellationAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getCancellationAlertSettings(): Promise<CancellationAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_cancellation_email_enabled"),
    getSetting("alert_cancellation_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}

export interface AdvertiserRequestAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getAdvertiserRequestAlertSettings(): Promise<AdvertiserRequestAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_advertiser_request_email_enabled"),
    getSetting("alert_advertiser_request_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}
