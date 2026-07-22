import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;
  if (!check.advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: check.advertiser.id } },
    select: { id: true, status: true },
  });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  if (!ACTIVE_STATUSES.includes(ad.status)) {
    return NextResponse.json({ error: "Este anúncio não pode mais ser cancelado" }, { status: 409 });
  }

  await db.privateAd.update({ where: { id }, data: { status: "CANCELLED" } });

  return NextResponse.json({ ok: true });
}
