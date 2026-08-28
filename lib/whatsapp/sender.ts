import { getWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp-settings";
import { buildEvolutionSender } from "./evolution-sender";
import { buildTwilioSender } from "./twilio-client";

export interface SendContext {
  messageType?: string;
}

export interface WhatsAppSender {
  readonly provider: WhatsAppProvider;
  sendText(phone: string, text: string, ctx: SendContext): Promise<{ providerMessageId: string | null }>;
  sendMedia(
    phone: string,
    base64Media: string,
    filename: string,
    caption: string,
    mediatype: "document" | "image",
    ctx: SendContext,
  ): Promise<{ providerMessageId: string | null }>;
  isConfigured(): boolean;
}

export async function getWhatsAppSender(): Promise<WhatsAppSender> {
  const provider = await getWhatsAppProvider();
  if (provider === "twilio") return buildTwilioSender();
  return buildEvolutionSender();
}
