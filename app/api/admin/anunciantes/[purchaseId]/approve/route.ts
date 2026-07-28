import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendAdvertiserRequestApprovedEmail } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      adPlan: { select: { name: true, durationDays: true } },
      advertiser: { select: { userId: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + purchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await db.adPurchase.update({ where: { id: purchaseId }, data: { status: "PAID", startAt, endAt } });
  await db.user.update({ where: { id: purchase.advertiser.userId }, data: { role: "ADVERTISER" } });

  try {
    await sendAdvertiserRequestApprovedEmail({
      to: purchase.advertiser.user.email,
      name: purchase.advertiser.user.name,
      planName: purchase.adPlan.name,
    });
  } catch (err) {
    console.error("[admin/anunciantes/approve] falha ao enviar e-mail:", err);
  }

  return NextResponse.json({ ok: true });
}
