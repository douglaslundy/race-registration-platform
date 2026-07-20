import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { deleteInstance, logoutInstance } from "@/lib/whatsapp/evolution-client";

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
    // A Evolution API frequentemente rejeita (ou não conclui de fato) a exclusão de uma
    // instância que ainda está conectada -- desloga primeiro, best-effort, antes de excluir.
    try {
      await logoutInstance(config);
    } catch {
      // Já pode estar desconectada; a exclusão segue tentando de qualquer forma.
    }
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
