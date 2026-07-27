import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateAdSlot } from "@/lib/ad-slots";
import { deleteHouseAdImage } from "@/lib/ads/house-ad-storage";
import { validateAdDestinationUrl } from "@/lib/validate-url";
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
    const validated = validateAdDestinationUrl(parsed.data.houseAdTargetUrl, { allowRelative: true });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    parsed.data.houseAdTargetUrl = validated.url;
  }

  if (parsed.data.houseAdImageUrl === null) {
    const current = await db.adSlot.findUnique({ where: { id }, select: { houseAdImageUrl: true } });
    if (current?.houseAdImageUrl) {
      await deleteHouseAdImage(current.houseAdImageUrl);
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
