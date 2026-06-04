import { getSetting } from "./settings";

export type PaymentProviderKey = "sandbox" | "mercadopago";

const DEFAULT_PAYMENT_PROVIDER: PaymentProviderKey = (process.env.PAYMENT_PROVIDER as PaymentProviderKey | undefined) ?? "sandbox";

export async function getPaymentProviderSetting(): Promise<PaymentProviderKey> {
  const value = (await getSetting("payment_provider"))?.toLowerCase();
  if (value === "mercadopago" || value === "sandbox") return value;
  return DEFAULT_PAYMENT_PROVIDER;
}

export async function getMercadoPagoAccessToken(): Promise<string | null> {
  return (await getSetting("mp_access_token")) ?? process.env.MP_ACCESS_TOKEN ?? null;
}

export async function getMercadoPagoWebhookSecret(): Promise<string | null> {
  return (await getSetting("mp_webhook_secret")) ?? process.env.MP_WEBHOOK_SECRET ?? null;
}
