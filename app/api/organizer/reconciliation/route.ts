import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments({ organizerUserId: session.user.id });
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
