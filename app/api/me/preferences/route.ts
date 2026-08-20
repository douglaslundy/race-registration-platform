import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z
  .object({
    uiDensity: z.enum(["comfortable", "compact"]).optional(),
    receivePromotionalMessages: z.boolean().optional(),
    receiveEventMessages: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo informado" });

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
      data: {
        ...(parsed.data.uiDensity !== undefined ? { uiDensity: parsed.data.uiDensity } : {}),
        ...(parsed.data.receivePromotionalMessages !== undefined
          ? { receivePromotionalMessages: parsed.data.receivePromotionalMessages }
          : {}),
        ...(parsed.data.receiveEventMessages !== undefined
          ? { receiveEventMessages: parsed.data.receiveEventMessages }
          : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me/preferences] update error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
