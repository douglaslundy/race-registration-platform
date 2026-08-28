import { getSetting } from "./settings";

export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const [apiUrl, apiKey, instanceName] = await Promise.all([
    getSetting("whatsapp_api_url"),
    getSetting("whatsapp_api_key"),
    getSetting("whatsapp_instance_name"),
  ]);

  return {
    apiUrl: (apiUrl ?? process.env.WHATSAPP_API_URL ?? "").replace(/\/+$/, ""),
    apiKey: apiKey ?? process.env.WHATSAPP_API_KEY ?? "",
    instanceName: instanceName ?? process.env.WHATSAPP_INSTANCE_NAME ?? "",
  };
}

export function isWhatsAppConfigured(config: WhatsAppConfig): boolean {
  return Boolean(config.apiUrl && config.apiKey && config.instanceName);
}

export type WhatsAppProvider = "evolution" | "twilio";

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  const v = (await getSetting("whatsapp_provider"))?.toLowerCase();
  if (v === "twilio" || v === "evolution") return v;
  const env = process.env.WHATSAPP_PROVIDER?.toLowerCase();
  return env === "twilio" ? "twilio" : "evolution";
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** número WhatsApp habilitado, E.164 sem o prefixo "whatsapp:" (ex: "+5511999999999") */
  fromNumber: string;
  /** Content SID do template utilitário aprovado (uma variável de corpo {{1}}) */
  contentSid: string;
}

export async function getTwilioConfig(): Promise<TwilioConfig> {
  const [accountSid, authToken, fromNumber, contentSid] = await Promise.all([
    getSetting("twilio_account_sid"),
    getSetting("twilio_auth_token"),
    getSetting("twilio_from_number"),
    getSetting("twilio_content_sid"),
  ]);
  return {
    accountSid: accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: (fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? "").trim(),
    contentSid: (contentSid ?? process.env.TWILIO_CONTENT_SID ?? "").trim(),
  };
}

export function isTwilioConfigured(c: TwilioConfig): boolean {
  return Boolean(c.accountSid && c.authToken && c.fromNumber && c.contentSid);
}
