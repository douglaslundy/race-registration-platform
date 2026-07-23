import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordClick } from "@/lib/ads/private-ad-metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const slot = await db.adSlot.findUnique({ where: { id: slotId } });

  if (!slot || slot.source !== "HOUSE" || !slot.houseAdTargetUrl) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await recordClick(slot.id);
  return new Response(null, {
    status: 307,
    headers: { location: slot.houseAdTargetUrl },
  });
}
