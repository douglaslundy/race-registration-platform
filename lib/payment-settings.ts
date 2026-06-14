import { getSetting } from "./settings";

export type PaymentProviderKey = "sandbox" | "mercadopago" | "pagarme";

const DEFAULT_PAYMENT_PROVIDER: PaymentProviderKey = (process.env.PAYMENT_PROVIDER as PaymentProviderKey | undefined) ?? "sandbox";

export async function getPaymentProviderSetting(): Promise<PaymentProviderKey> {
  const value = (await getSetting("payment_provider"))?.toLowerCase();
  if (value === "mercadopago" || value === "sandbox" || value === "pagarme") return value;
  return DEFAULT_PAYMENT_PROVIDER;
}

export async function getMercadoPagoAccessToken(): Promise<string | null> {
  return (await getSetting("mp_access_token")) ?? process.env.MP_ACCESS_TOKEN ?? null;
}

export async function getMercadoPagoWebhookSecret(): Promise<string | null> {
  return (await getSetting("mp_webhook_secret")) ?? process.env.MP_WEBHOOK_SECRET ?? null;
}

export async function getMercadoPagoPublicKey(): Promise<string | null> {
  return (await getSetting("mp_public_key")) ?? process.env.MP_PUBLIC_KEY ?? null;
}

export async function getPagarMeApiKey(): Promise<string | null> {
  return (await getSetting("pagarme_api_key")) ?? process.env.PAGARME_API_KEY ?? null;
}

export async function getPagarMePublicKey(): Promise<string | null> {
  return (await getSetting("pagarme_public_key")) ?? process.env.PAGARME_PUBLIC_KEY ?? null;
}

export async function getPagarMeWebhookPassword(): Promise<string | null> {
  return (await getSetting("pagarme_webhook_password")) ?? process.env.PAGARME_WEBHOOK_PASSWORD ?? null;
}
