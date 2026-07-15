import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const check = await checkApiPermission("registrations.expire-payments");
  if (!check.allowed) return check.response;
  const { session } = check;

  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }

  const [payments, orders] = await Promise.all([
    expirePendingPayments({ organizerUserId }),
    expireAbandonedOrders({ organizerUserId }),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
