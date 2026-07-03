import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments();
  return NextResponse.json(result);
}
