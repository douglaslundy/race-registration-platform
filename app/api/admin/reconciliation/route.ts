import { NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { reconcilePayments } from "@/lib/payment/reconciliation";

export async function POST() {
  const check = await checkAdminOnlyApiPermission("payments.reconciliation-any");
  if (!check.allowed) return check.response;

  const result = await reconcilePayments();
  return NextResponse.json(result);
}
