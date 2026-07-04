import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { expirePendingPayments } from "@/lib/payment/expire-payments";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await expirePendingPayments();
  return NextResponse.json(result);
}
