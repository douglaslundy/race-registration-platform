import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, isWhatsAppConfigured, type WhatsAppConfig } from "@/lib/whatsapp-settings";
import { getConnectionState, setWebhook } from "@/lib/whatsapp/evolution-client";

async function registerWebhookBestEffort(config: WhatsAppConfig): Promise<void> {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (!secret || !baseUrl) return;

  try {
    await setWebhook(config, `${baseUrl}/api/webhooks/whatsapp?secret=${secret}`);
  } catch {
    // Best-effort — não deve quebrar a checagem de status.
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
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
