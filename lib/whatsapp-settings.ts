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

/**
 * Normaliza o número de origem do Twilio: remove espaços, tira o prefixo "whatsapp:" (o SDK espera
 * só o E.164, o "whatsapp:" é adicionado na hora do envio) e força um "+" na frente quando o valor
 * salvo veio só com dígitos (erro comum ao copiar do console do Twilio).
 */
export function normalizeTwilioFromNumber(raw: string): string {
  let v = raw.trim();
  if (/^whatsapp:/i.test(v)) v = v.slice(v.indexOf(":") + 1).trim();
  if (/^\d+$/.test(v)) v = `+${v}`;
  return v;
}

export async function getTwilioConfig(): Promise<TwilioConfig> {
  const [accountSid, authToken, fromNumber, contentSid] = await Promise.all([
    getSetting("twilio_account_sid"),
    getSetting("twilio_auth_token"),
    getSetting("twilio_from_number"),
    getSetting("twilio_content_sid"),
  ]);
  return {
    accountSid: (accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "").trim(),
    authToken: (authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "").trim(),
    fromNumber: normalizeTwilioFromNumber(fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? ""),
    contentSid: (contentSid ?? process.env.TWILIO_CONTENT_SID ?? "").trim(),
  };
}

export function isTwilioConfigured(c: TwilioConfig): boolean {
  // accountSid TEM que começar com "AC" — o SDK do Twilio rejeita qualquer outra coisa (ex.: um
  // API Key SID "SK…" ou um typo) lançando um Error cru no construtor. Barrar aqui faz a UI mostrar
  // "não configurado" e o caminho de envio lançar o erro de "não configurado" normal, em vez de a
  // construção do client explodir fora de qualquer try/catch.
  return Boolean(c.accountSid.startsWith("AC") && c.authToken && c.fromNumber && c.contentSid);
}
