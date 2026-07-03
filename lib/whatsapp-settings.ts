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
