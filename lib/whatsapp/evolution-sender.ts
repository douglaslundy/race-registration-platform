import { getWhatsAppConfig, isWhatsAppConfigured, type WhatsAppConfig } from "@/lib/whatsapp-settings";
import { sendTextMessage, sendMediaMessage } from "./evolution-client";
import type { WhatsAppSender, SendContext } from "./sender";

export class EvolutionSender implements WhatsAppSender {
  readonly provider = "evolution" as const;
  constructor(private config: WhatsAppConfig) {}

  isConfigured() {
    return isWhatsAppConfigured(this.config);
  }

  async sendText(phone: string, text: string, _ctx: SendContext) {
    return sendTextMessage(this.config, phone, text);
  }

  async sendMedia(
    phone: string,
    base64Media: string,
    filename: string,
    caption: string,
    mediatype: "document" | "image",
    _ctx: SendContext,
  ) {
    return sendMediaMessage(this.config, phone, base64Media, filename, caption, mediatype);
  }
}

export async function buildEvolutionSender(): Promise<EvolutionSender> {
  return new EvolutionSender(await getWhatsAppConfig());
}
