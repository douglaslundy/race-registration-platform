import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhatsAppConfig, getWhatsAppProvider, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { createInstance, getConnectionState, getQrCode } from "@/lib/whatsapp/evolution-client";

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
    return NextResponse.json(
      { error: "Configure a URL, a API key e o nome da instância antes de gerar o QR code" },
      { status: 400 },
    );
  }

  try {
    const state = await getConnectionState(config);
    const { qrCodeBase64 } = state === "not_found" ? await createInstance(config) : await getQrCode(config);

    if (state === "not_found") {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "WHATSAPP_INSTANCE_CREATED",
          entityType: "PlatformSetting",
          entityId: config.instanceName,
        },
      });
    }

    return NextResponse.json({ qrCodeBase64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao gerar QR code";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
