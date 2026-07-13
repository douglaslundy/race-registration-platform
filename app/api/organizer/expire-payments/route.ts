import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const [payments, orders] = await Promise.all([
    expirePendingPayments({ organizerUserId: session.user.id }),
    expireAbandonedOrders({ organizerUserId: session.user.id }),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
