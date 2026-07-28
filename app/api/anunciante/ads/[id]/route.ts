import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { validateAdDestinationUrl } from "@/lib/validate-url";

const schema = z.object({ targetUrl: z.string() });
const EDITABLE_STATUSES = ["PENDING_APPROVAL", "APPROVED"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;
  if (!check.advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validatedUrl = validateAdDestinationUrl(parsed.data.targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }

  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: check.advertiser.id } },
    select: { id: true, status: true },
  });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.includes(ad.status)) {
    return NextResponse.json({ error: "Este anúncio não pode mais ser editado" }, { status: 400 });
  }

  const wasApproved = ad.status === "APPROVED";
  await db.privateAd.update({
    where: { id },
    data: wasApproved
      ? { targetUrl: validatedUrl.url, status: "PENDING_APPROVAL", rejectionReason: null }
      : { targetUrl: validatedUrl.url },
  });

  return NextResponse.json({ ok: true, requiresReview: wasApproved });
}
