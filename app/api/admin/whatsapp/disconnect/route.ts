import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, getWhatsAppProvider, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { logoutInstance } from "@/lib/whatsapp/evolution-client";

export async function POST() {
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
    return NextResponse.json({ error: "WhatsApp não configurado" }, { status: 400 });
  }

  try {
    await logoutInstance(config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao desconectar";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
