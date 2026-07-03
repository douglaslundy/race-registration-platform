import { NextRequest, NextResponse } from "next/server";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await reconcilePayments();
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
