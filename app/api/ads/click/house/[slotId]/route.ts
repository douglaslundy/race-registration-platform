import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordClick } from "@/lib/ads/private-ad-metrics";
import { shouldCountAdClick } from "@/lib/ads/abuse-guard";

export async function GET(req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const slot = await db.adSlot.findUnique({ where: { id: slotId } });

  if (!slot || slot.source !== "HOUSE" || !slot.houseAdTargetUrl) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  // M7: só contabiliza cliques reais — ignora prefetch e dedupe por IP+slot.
  if (shouldCountAdClick(req, `house:${slot.id}`)) {
    await recordClick(slot.id, "HOUSE");
  }
  return new Response(null, {
    status: 307,
    headers: { location: slot.houseAdTargetUrl },
  });
}
