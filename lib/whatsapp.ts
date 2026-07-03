import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { sendTextMessage } from "./whatsapp/evolution-client";

/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  await sendTextMessage(config, phone, text);
}
