import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getWhatsAppConfig,
  getWhatsAppProvider,
  isWhatsAppConfigured,
  type WhatsAppConfig,
} from "@/lib/whatsapp-settings";
import { getConnectionState, setWebhook } from "@/lib/whatsapp/evolution-client";

async function registerWebhookBestEffort(config: WhatsAppConfig): Promise<void> {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (!secret || !baseUrl) return;

  try {
    // L2: segredo vai no header, não na query string (evita vazamento em logs de proxy).
    await setWebhook(config, `${baseUrl}/api/webhooks/whatsapp`, { "x-webhook-secret": secret });
  } catch {
    // Best-effort — não deve quebrar a checagem de status.
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  if ((await getWhatsAppProvider()) === "twilio") {
    return NextResponse.json(
      { error: "Ação disponível apenas com o provedor Evolution API" },
      { status: 400 },
    );
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ state: "not_configured" });
  }

  try {
    const state = await getConnectionState(config);
    if (state === "open") {
      await registerWebhookBestEffort(config);
    }
    return NextResponse.json({ state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao consultar status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
