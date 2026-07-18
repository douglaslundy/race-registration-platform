import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { sendTextMessage } from "./whatsapp/evolution-client";
import { recordMessageLog } from "./message-logs";

function truncateForSubject(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }

  const subject = truncateForSubject(text);

  try {
    const { providerMessageId } = await sendTextMessage(config, phone, text);
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: phone,
      status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}),
    });
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: phone,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
