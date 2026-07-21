import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  if (!advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: advertiser.id } },
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
