import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/rbac";
import { upsertSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(500),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await upsertSetting(parsed.data.key, parsed.data.value);
  } catch (err) {
    console.error("[settings] upsertSetting failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true });
}
