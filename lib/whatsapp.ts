import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { sendTextMessage, sendMediaMessage } from "./whatsapp/evolution-client";
import { recordMessageLog } from "./message-logs";

function truncateForSubject(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * Normaliza um telefone brasileiro pro formato que a Evolution API espera (só dígitos, sempre
 * com o DDI 55), aceitando o número com ou sem "+55"/formatação. Não duplica o DDI se ele já
 * estiver presente.
 */
export function normalizePhoneForWhatsApp(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }

  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  const subject = truncateForSubject(text);

  try {
    const { providerMessageId } = await sendTextMessage(config, normalizedPhone, text);
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: normalizedPhone,
      status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}),
    });
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: normalizedPhone,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Envia um documento (PDF) por WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppDocument(
  phone: string,
  base64Pdf: string,
  filename: string,
  caption: string,
): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  await sendMediaMessage(config, normalizedPhone, base64Pdf, filename, caption);
}
