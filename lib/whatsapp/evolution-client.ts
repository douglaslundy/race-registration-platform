import type { WhatsAppConfig } from "@/lib/whatsapp-settings";

export type ConnectionState = "open" | "connecting" | "close" | "not_found";

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
    throw new Error(`Evolution API ${status} ao enviar mensagem: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const messageId = (body as { key?: { id?: string } } | null)?.key?.id;
  return { providerMessageId: typeof messageId === "string" ? messageId : null };
}

export async function setWebhook(config: WhatsAppConfig, url: string): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/webhook/set/${config.instanceName}`, {
    method: "POST",
    body: { webhook: { url, enabled: true, events: ["MESSAGES_UPDATE"] } },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao configurar webhook: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
