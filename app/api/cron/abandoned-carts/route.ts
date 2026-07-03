import { NextRequest, NextResponse } from "next/server";
import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await checkAbandonedCarts();
  return NextResponse.json(result);
}
