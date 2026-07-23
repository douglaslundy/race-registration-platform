import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateAdSlot } from "@/lib/ad-slots";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
  houseAdImageUrl: z.string().max(500).nullable().optional(),
  houseAdTargetUrl: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
