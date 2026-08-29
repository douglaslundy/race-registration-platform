import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { upsertSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(500),
});

function isSecretKey(key: string): boolean {
  // `*_sid` cobre credenciais do provedor que não terminam em _token/_key/_secret/_password mas
  // ainda identificam a conta (ex.: `twilio_account_sid`, `twilio_content_sid`) e nunca podem ir
  // pro AuditLog em claro (requisito 4). NÃO usar `_id$` genérico — pegaria IDs públicos que
  // aparecem no HTML (`google_adsense_client_id`, `seo_google_analytics_id`) e só perderia rastro.
  return /(_token|_key|_secret|_password|_sid)$/.test(key);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.key === "pix_service_fee_discount_percent") {
    const n = Number(parsed.data.value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: "Desconto PIX deve ser um inteiro entre 0 e 100" },
        { status: 400 },
      );
    }
    parsed.data.value = String(n); // persiste normalizado (getPixServiceFeeDiscountPercent lê com parseInt)
  }

  try {
    const previous = await db.platformSetting.findUnique({ where: { key: parsed.data.key } });
    await upsertSetting(parsed.data.key, parsed.data.value);
    const masked = isSecretKey(parsed.data.key);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTING_UPDATED",
        entityType: "PlatformSetting",
        entityId: parsed.data.key,
        metadata: {
          key: parsed.data.key,
          oldValue: masked ? (previous?.value ? "***" : null) : (previous?.value ?? null),
          newValue: masked ? "***" : parsed.data.value,
        },
      },
    });
  } catch (err) {
    // NÃO logar `err.message` nem devolvê-lo: um PrismaClientValidationError serializa o objeto de
    // argumentos (incluindo o valor sendo salvo, que pode ser um token/secret). Só o nome do erro
    // vai pro log do servidor; o cliente recebe uma string fixa.
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error("[settings] upsertSetting failed:", name);
    return NextResponse.json({ error: "Erro ao salvar configuração" }, { status: 500 });
  }

  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true });
}
