import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const orderId = searchParams.get("order");
  const paymentId = searchParams.get("payment_id");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!orderId) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes`);
  }

  if (status === "approved" && paymentId) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { registrations: { take: 1 } },
    });

    if (order && order.status !== "PAID") {
      await db.$transaction([
        db.order.update({ where: { id: orderId }, data: { status: "PAID" } }),
        ...order.registrations.map((r) =>
          db.registration.update({ where: { id: r.id }, data: { status: "CONFIRMED" } })
        ),
        db.payment.updateMany({
          where: { orderId, status: "PENDING" },
          data: { status: "PAID", paidAt: new Date(), providerPaymentId: paymentId },
        }),
      ]);
    }

    const regId = order?.registrations[0]?.id;
    if (regId) {
      return NextResponse.redirect(`${appUrl}/dashboard/inscricoes/${regId}?confirmed=1`);
    }
  }

  if (status === "failure") {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_failed=1`);
  }

  return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_pending=1`);
}
