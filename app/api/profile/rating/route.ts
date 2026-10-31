import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getRatingSummary } from "@/lib/rating";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { avatarUrl: true } });
  const summary = await getRatingSummary(session.user.id, session.user.role);
  return NextResponse.json({ ...summary, avatarUrl: user?.avatarUrl ?? null });
}
