import { getWhatsAppSender } from "./whatsapp/sender";
import { WhatsAppSendError, whatsAppErrorLabel } from "./whatsapp/errors";
import { recordMessageLog } from "./message-logs";

function truncateForSubject(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * Mensagem de erro segura para gravar no MessageLog: para uma falha normalizada do provider
 * (`WhatsAppSendError`) grava só `kind` + rótulo amigável, nunca o `providerCode`, token, SID
 * ou corpo cru da resposta. Para qualquer outro erro, trunca a mensagem.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof WhatsAppSendError) return `${err.kind}: ${whatsAppErrorLabel(err.kind)}`;
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 200);
}

export function buildPreferencesFooterText(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `\n\nPara alterar ou cancelar o recebimento de mensagens, acesse suas preferências de comunicação: ${baseUrl}/preferencias`;
}

/**
 * Normaliza um telefone brasileiro pro formato que os providers de WhatsApp esperam (só dígitos,
 * sempre com o DDI 55), aceitando o número com ou sem "+55"/formatação. Não duplica o DDI se ele
 * já estiver presente.
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

/** Verifica se um telefone já normalizado (via normalizePhoneForWhatsApp) tem formato válido pra
 * WhatsApp: DDI 55 (Brasil) + 10 ou 11 dígitos locais (fixo ou celular). */
export function isValidWhatsAppPhone(normalized: string): boolean {
  return /^55\d{10,11}$/.test(normalized);
}

/** Envia uma mensagem de WhatsApp pelo provider ativo (Evolution ou Twilio), registrando o
 * resultado no MessageLog. O despacho por provider fica em `getWhatsAppSender()`; o MessageLog
 * continua nesta camada — os dois providers passam pelo mesmo caminho de auditoria. */
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType?: string,
  options?: {
    relatedEntityType?: string;
    relatedEntityId?: string;
    logSubject?: string;
    /** Acrescenta o rodapé de opt-out (link estático pra /preferencias) ao final do texto — usar
     * só nas mensagens de evento/promocionais que respeitam receiveEventMessages/
     * receivePromotionalMessages, nunca em código de verificação ou mensagem de sistema. */
    appendPreferencesFooter?: boolean;
  },
): Promise<{ providerMessageId?: string }> {
  const sender = await getWhatsAppSender();
  if (!sender.isConfigured()) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }

  const finalText = options?.appendPreferencesFooter ? `${text}${buildPreferencesFooterText()}` : text;
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  const subject = options?.logSubject ?? truncateForSubject(finalText);
  const relatedEntity =
    options?.relatedEntityType && options?.relatedEntityId
      ? { relatedEntityType: options.relatedEntityType, relatedEntityId: options.relatedEntityId }
      : {};

  try {
    const { providerMessageId } = await sender.sendText(normalizedPhone, finalText, { messageType });
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType,
      subject,
      recipientAddress: normalizedPhone,
      status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}),
      ...relatedEntity,
    });
    return { providerMessageId: providerMessageId ?? undefined };
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType,
      subject,
      recipientAddress: normalizedPhone,
      status: "FAILED",
      errorMessage: safeErrorMessage(err),
      ...relatedEntity,
    });
    throw err;
  }
}

/** Envia um documento (PDF/imagem) por WhatsApp pelo provider ativo, registrando o envio no
 * MessageLog (sucesso ou falha) — mesmo comportamento de auditoria de `sendWhatsAppMessage`,
 * necessário porque este envio deixou de ser só pra relatórios de anúncio ocasionais e passou a
 * rodar em todo envio de confirmação de inscrição (QR do kit). */
export async function sendWhatsAppDocument(
  phone: string,
  base64Pdf: string,
  filename: string,
  caption: string,
  options?: {
    messageType?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    /** "image" faz o WhatsApp renderizar inline na conversa (com miniatura, sem precisar abrir
     * como arquivo) — use pra imagens como o QR code de retirada de kit. O padrão "document"
     * preserva o comportamento existente (ex.: PDF de relatório de anúncio). */
    mediatype?: "document" | "image";
  },
): Promise<void> {
  const sender = await getWhatsAppSender();
  if (!sender.isConfigured()) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  const relatedEntity =
    options?.relatedEntityType && options?.relatedEntityId
      ? { relatedEntityType: options.relatedEntityType, relatedEntityId: options.relatedEntityId }
      : {};

  try {
    const { providerMessageId } = await sender.sendMedia(
      normalizedPhone,
      base64Pdf,
      filename,
      caption,
      options?.mediatype ?? "document",
      { messageType: options?.messageType },
    );
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType: options?.messageType,
      subject: caption,
      recipientAddress: normalizedPhone,
      status: "SENT",
      // Evolution devolve null aqui (o spread condicional omite o campo); Twilio devolve o SID da
      // mensagem, necessário pra correlacionar o webhook de status de entrega.
      ...(providerMessageId ? { providerMessageId } : {}),
      ...relatedEntity,
    });
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType: options?.messageType,
      subject: caption,
      recipientAddress: normalizedPhone,
      status: "FAILED",
      errorMessage: safeErrorMessage(err),
      ...relatedEntity,
    });
    throw err;
  }
}
