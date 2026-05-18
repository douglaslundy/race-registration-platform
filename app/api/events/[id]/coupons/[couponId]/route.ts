import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, couponId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  await db.coupon.delete({ where: { id: couponId } });
  return NextResponse.json({ success: true });
}
