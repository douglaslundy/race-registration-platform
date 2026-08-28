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
  "21614": "INVALID_NUMBER",
  "63003": "INVALID_NUMBER",
  "63016": "INVALID_TEMPLATE",
  "63018": "INVALID_TEMPLATE",
  "63005": "INVALID_TEMPLATE",
  "20429": "RATE_LIMITED",
  "20500": "PROVIDER_UNAVAILABLE",
  ETIMEDOUT: "TIMEOUT",
  ECONNABORTED: "TIMEOUT",
};

export function classifyTwilioError(err: unknown): WhatsAppSendError {
  const e = err as { code?: string | number; status?: number; message?: string } | undefined;
  const code = e?.code != null ? String(e.code) : undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const msg = String(e?.message ?? "").toLowerCase();

  let kind: WhatsAppErrorKind = "UNKNOWN";
  if (code && CODE_KIND[code]) kind = CODE_KIND[code];
  else if (status === 429) kind = "RATE_LIMITED";
  else if (status != null && status >= 500) kind = "PROVIDER_UNAVAILABLE";
  else if (msg.includes("timeout")) kind = "TIMEOUT";

  return new WhatsAppSendError(
    kind,
    `falha ao enviar WhatsApp (Twilio)`,
    code ?? (status != null ? String(status) : undefined),
  );
}

export class TwilioSender implements WhatsAppSender {
  readonly provider = "twilio" as const;
  private client: ReturnType<typeof twilio>;

  constructor(private config: TwilioConfig) {
    this.client = twilio(config.accountSid, config.authToken, { timeout: 10_000 });
  }

  isConfigured() {
    return isTwilioConfigured(this.config);
  }

  async sendText(phone: string, text: string, _ctx: SendContext) {
    try {
      const cb = twilioStatusCallbackUrl();
      const msg = await this.client.messages.create({
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
