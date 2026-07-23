import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordClick } from "@/lib/ads/private-ad-metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ privateAdId: string }> }) {
  const { privateAdId } = await params;
  const ad = await db.privateAd.findUnique({ where: { id: privateAdId } });

  if (!ad || ad.status !== "APPROVED") {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await recordClick(ad.adSlotId, "PRIVATE");
  return new Response(null, {
    status: 307,
    headers: { location: ad.targetUrl }
  });
}
