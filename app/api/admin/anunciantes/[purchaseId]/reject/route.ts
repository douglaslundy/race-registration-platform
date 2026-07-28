import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
import { sendAdvertiserRequestRejectedEmail } from "@/lib/email";

const schema = z.object({ reason: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      advertiser: { select: { user: { select: { name: true, email: true } } } },
      payments: { select: { id: true }, where: { status: "PAID" }, take: 1 },
    },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  await db.adPurchase.update({
    where: { id: purchaseId },
    data: { status: "REJECTED", rejectionReason: parsed.data.reason },
  });

  const payment = purchase.payments[0];
  let refundFailed = false;
  let refunded = false;
  if (payment) {
    try {
      await refundPayment({ paymentId: payment.id, initiatedByUserId: session.user.id, reason: parsed.data.reason });
      refunded = true;
    } catch (err) {
      refundFailed = true;
      console.error(
        `[admin/anunciantes/reject] falha ao estornar pagamento (purchaseId=${purchaseId}, paymentId=${payment.id}):`,
        err,
      );
    }
  }

  try {
    await sendAdvertiserRequestRejectedEmail({
      to: purchase.advertiser.user.email,
      name: purchase.advertiser.user.name,
      reason: parsed.data.reason,
      refunded,
    });
  } catch (err) {
    console.error(`[admin/anunciantes/reject] falha ao enviar e-mail (purchaseId=${purchaseId}):`, err);
  }

  return NextResponse.json({ ok: true, refundFailed });
}
