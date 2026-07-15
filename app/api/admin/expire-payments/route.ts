import { NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const check = await checkAdminOnlyApiPermission("registrations.expire-payments-any");
  if (!check.allowed) return check.response;

  const [payments, orders] = await Promise.all([
    expirePendingPayments(),
    expireAbandonedOrders(),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
