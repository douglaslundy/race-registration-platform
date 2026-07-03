import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { deleteInstance } from "@/lib/whatsapp/evolution-client";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ error: "WhatsApp não configurado" }, { status: 400 });
  }

  try {
    await deleteInstance(config);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "WHATSAPP_INSTANCE_DELETED",
        entityType: "PlatformSetting",
        entityId: config.instanceName,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao excluir instância";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
