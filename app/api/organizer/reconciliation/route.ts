import { NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST() {
  const check = await checkApiPermission("payments.reconciliation");
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

  const result = await reconcilePayments({ organizerUserId });
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
