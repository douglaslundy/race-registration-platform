import { NextRequest, NextResponse } from "next/server";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await expirePendingPayments();
  return NextResponse.json(result);
}
