import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { getConnectionState } from "@/lib/whatsapp/evolution-client";

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
    return NextResponse.json({ state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao consultar status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
