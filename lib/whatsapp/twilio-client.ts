import twilio from "twilio";
import { getTwilioConfig, isTwilioConfigured, type TwilioConfig } from "@/lib/whatsapp-settings";
import { WhatsAppSendError, type WhatsAppErrorKind } from "./errors";
import type { WhatsAppSender, SendContext } from "./sender";

export function twilioStatusCallbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/api/webhooks/whatsapp/twilio` : "";
}

const CODE_KIND: Record<string, WhatsAppErrorKind> = {
  "20003": "AUTH",
  "21211": "INVALID_NUMBER",
  "21214": "INVALID_NUMBER",
  "21610": "INVALID_NUMBER", // destinatário deu opt-out (STOP) do número Twilio
  "21614": "INVALID_NUMBER",
  "63003": "INVALID_NUMBER",
  "63016": "INVALID_TEMPLATE",
  "63018": "INVALID_TEMPLATE",
  "63005": "INVALID_TEMPLATE",
  "21612": "INVALID_NUMBER", // número não alcançável por WhatsApp a partir deste remetente
  "63007": "PROVIDER_UNAVAILABLE", // canal/remetente WhatsApp não encontrado nesta conta
  "20429": "RATE_LIMITED",
  "20500": "PROVIDER_UNAVAILABLE",
  ETIMEDOUT: "TIMEOUT",
  ECONNABORTED: "TIMEOUT",
  ECONNREFUSED: "PROVIDER_UNAVAILABLE",
  ENOTFOUND: "PROVIDER_UNAVAILABLE",
};

export function classifyTwilioError(err: unknown): WhatsAppSendError {
  // Já normalizado (ex.: erro do construtor propagado por sendText/sendMedia) — repassa sem
  // reclassificar, senão o kind original (AUTH etc.) viraria UNKNOWN.
  if (err instanceof WhatsAppSendError) return err;

  const e = err as { code?: string | number; status?: number; message?: string } | undefined;
  const code = e?.code != null ? String(e.code) : undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const msg = String(e?.message ?? "").toLowerCase();

  let kind: WhatsAppErrorKind = "UNKNOWN";
  if (code && CODE_KIND[code]) kind = CODE_KIND[code];
  else if (status === 429) kind = "RATE_LIMITED";
  else if (status != null && status >= 500) kind = "PROVIDER_UNAVAILABLE";
  else if (msg.includes("timeout")) kind = "TIMEOUT";
  // Validação eager do SDK Twilio (accountSid que não começa com "AC", credenciais malformadas):
  // lança um Error cru antes de qualquer chamada de rede.
  else if (msg.includes("accountsid") || msg.includes("must start with ac") || msg.includes("username is required"))
    kind = "AUTH";

  // Detalhe cru (código/status/mensagem do provider) só no console — nunca na mensagem do
  // WhatsAppSendError nem no MessageLog. Espelha o evolution-client.
  console.error(
    "[twilio] send failed code=%s status=%s message=%s",
    code ?? "-",
    status ?? "-",
    e?.message ?? "-",
  );

  return new WhatsAppSendError(
    kind,
    "falha ao enviar WhatsApp (Twilio)",
    code ?? (status != null ? String(status) : undefined),
  );
}

export class TwilioSender implements WhatsAppSender {
  readonly provider = "twilio" as const;
  private client: ReturnType<typeof twilio> | null = null;

  constructor(private config: TwilioConfig) {}

  isConfigured() {
    return isTwilioConfigured(this.config);
  }

  async isReady() {
    // Twilio não tem conceito de "conexão" (não há instância pra manter online como na Evolution) —
    // estar configurado é suficiente.
    return this.isConfigured();
  }

  /**
   * Constrói o client Twilio sob demanda (depois da guarda `isConfigured` da camada de domínio) e
   * dentro do try/catch de envio. O construtor do SDK valida de forma eager e lança um `Error` cru
   * se o accountSid não começar com "AC" — fazer isso aqui garante que essa falha vire um
   * `WhatsAppSendError` normalizado (com linha FAILED no MessageLog e efeito no circuit breaker),
   * em vez de explodir dentro de `getWhatsAppSender()`, antes de qualquer tratamento.
   */
  private getClient(): ReturnType<typeof twilio> {
    if (this.client) return this.client;
    try {
      this.client = twilio(this.config.accountSid, this.config.authToken, { timeout: 10_000 });
    } catch (err) {
      throw classifyTwilioError(err);
    }
    return this.client;
  }

  async sendText(phone: string, text: string, _ctx: SendContext) {
    try {
      const client = this.getClient();
      const cb = twilioStatusCallbackUrl();
      const msg = await client.messages.create({
        from: `whatsapp:${this.config.fromNumber}`,
        to: `whatsapp:+${phone}`,
        contentSid: this.config.contentSid,
        contentVariables: JSON.stringify({ "1": text }),
        ...(cb ? { statusCallback: cb } : {}),
      });
      return { providerMessageId: msg.sid ?? null };
    } catch (err) {
      throw classifyTwilioError(err);
    }
  }

  async sendMedia(
    phone: string,
    _base64Media: string,
    filename: string,
    caption: string,
    _mediatype: "document" | "image",
    ctx: SendContext,
  ) {
    // Twilio exige mediaUrl HTTPS público — base64 não é suportado nesta leva.
    console.warn("[twilio] sendMedia sem suporte a base64 — enviando só a legenda. filename=%s", filename);
    return this.sendText(phone, caption, ctx);
  }
}

export async function buildTwilioSender(): Promise<TwilioSender> {
  return new TwilioSender(await getTwilioConfig());
}
