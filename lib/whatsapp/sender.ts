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
  /**
   * Pronto para enviar AGORA. Para a Evolution isso inclui checar o estado da instância ("open");
   * para o Twilio basta estar configurado. Usado pelos fluxos que só devem tentar o envio quando há
   * chance real de sucesso (ex.: confirmação de pedido em `lib/notifications.ts`), sem que a camada
   * chamadora precise saber qual é o provider ativo.
   */
  isReady(): Promise<boolean>;
}

export async function getWhatsAppSender(): Promise<WhatsAppSender> {
  const provider = await getWhatsAppProvider();
  if (provider === "twilio") return buildTwilioSender();
  return buildEvolutionSender();
}
