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
  }

  try {
    const previous = await db.platformSetting.findUnique({ where: { key: parsed.data.key } });
    await upsertSetting(parsed.data.key, parsed.data.value);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTING_UPDATED",
        entityType: "PlatformSetting",
        entityId: parsed.data.key,
        metadata: {
          key: parsed.data.key,
          oldValue: previous?.value ?? null,
          newValue: parsed.data.value,
        },
      },
    });
  } catch (err) {
    console.error("[settings] upsertSetting failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true });
}
