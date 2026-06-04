import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  uiDensity: z.enum(["comfortable", "compact"]),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await db.user.update({
      where: { id: session.user.id },
      data: { uiDensity: parsed.data.uiDensity },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me/preferences] update error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
