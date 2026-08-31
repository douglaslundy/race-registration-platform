import type { WhatsAppConfig } from "@/lib/whatsapp-settings";
import { WhatsAppSendError, type WhatsAppErrorKind } from "./errors";

export type ConnectionState = "open" | "connecting" | "close" | "not_found";

function kindFromEvolutionStatus(status: number, body: unknown): WhatsAppErrorKind {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMITED";
  if (status === 404) return "PROVIDER_UNAVAILABLE";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  if (status === 400) {
    const s = JSON.stringify(body ?? "").toLowerCase();
    if (s.includes("number") || s.includes("jid") || s.includes("exists")) return "INVALID_NUMBER";
  }
  return "UNKNOWN";
}

// Diferentes versões da Evolution API colocam o QR code em campos diferentes da resposta.
function extractQrCodeBase64(body: unknown): string | null {
  const b = body as Record<string, unknown> | null | undefined;
  if (!b) return null;
  const qrcode = b.qrcode;
  if (typeof qrcode === "string") return qrcode;
  if (qrcode && typeof qrcode === "object" && typeof (qrcode as Record<string, unknown>).base64 === "string") {
    return (qrcode as Record<string, unknown>).base64 as string;
  }
  if (typeof b.base64 === "string") return b.base64;
  return null;
}

async function evolutionFetch(
  config: WhatsAppConfig,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { apikey: config.apiKey };
  if (init.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createInstance(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }> {
  const { status, body } = await evolutionFetch(config, "/instance/create", {
    method: "POST",
    body: { instanceName: config.instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao criar instância: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return { qrCodeBase64: extractQrCodeBase64(body) };
}

export async function getQrCode(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }> {
  const { status, body } = await evolutionFetch(config, `/instance/connect/${config.instanceName}`, {
    method: "GET",
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao buscar QR code: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return { qrCodeBase64: extractQrCodeBase64(body) };
}

export async function getConnectionState(config: WhatsAppConfig): Promise<ConnectionState> {
  const { status, body } = await evolutionFetch(config, `/instance/connectionState/${config.instanceName}`, {
    method: "GET",
  });

  if (status === 404) return "not_found";
  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao consultar status: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const state = (body as { instance?: { state?: string } } | null)?.instance?.state;
  if (state === "open" || state === "connecting" || state === "close") return state;
  return "close";
}

export async function logoutInstance(config: WhatsAppConfig): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/instance/logout/${config.instanceName}`, {
    method: "POST",
  });

  if (status >= 400 && status !== 404) {
    throw new Error(`Evolution API ${status} ao desconectar: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export async function deleteInstance(config: WhatsAppConfig): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/instance/delete/${config.instanceName}`, {
    method: "DELETE",
  });

  if (status >= 400 && status !== 404) {
    throw new Error(`Evolution API ${status} ao excluir instância: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export async function sendTextMessage(
  config: WhatsAppConfig,
  phone: string,
  text: string,
): Promise<{ providerMessageId: string | null }> {
  const { status, body } = await evolutionFetch(config, `/message/sendText/${config.instanceName}`, {
    method: "POST",
    body: { number: phone, text },
  });

  if (status >= 400) {
    console.error("[evolution] sendText %d: %s", status, JSON.stringify(body).slice(0, 300));
    throw new WhatsAppSendError(
      kindFromEvolutionStatus(status, body),
      "falha ao enviar WhatsApp (Evolution)",
      String(status),
    );
  }

  const messageId = (body as { key?: { id?: string } } | null)?.key?.id;
  return { providerMessageId: typeof messageId === "string" ? messageId : null };
}

export async function sendMediaMessage(
  config: WhatsAppConfig,
  phone: string,
  base64Media: string,
  fileName: string,
  caption: string,
  mediatype: "document" | "image" = "document",
): Promise<{ providerMessageId: null }> {
  const { status, body } = await evolutionFetch(config, `/message/sendMedia/${config.instanceName}`, {
    method: "POST",
    body: { number: phone, mediatype, media: base64Media, fileName, caption },
  });

  if (status >= 400) {
    console.error("[evolution] sendMedia %d: %s", status, JSON.stringify(body).slice(0, 300));
    throw new WhatsAppSendError(
      kindFromEvolutionStatus(status, body),
      "falha ao enviar WhatsApp (Evolution)",
      String(status),
    );
  }

  return { providerMessageId: null };
}

export async function setWebhook(
  config: WhatsAppConfig,
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  const webhook: Record<string, unknown> = { url, enabled: true, events: ["MESSAGES_UPDATE"] };
  // L2: manda o segredo do webhook como header (não na query string) quando suportado.
  if (headers && Object.keys(headers).length > 0) webhook.headers = headers;
  const { status, body } = await evolutionFetch(config, `/webhook/set/${config.instanceName}`, {
    method: "POST",
    body: { webhook },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao configurar webhook: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
