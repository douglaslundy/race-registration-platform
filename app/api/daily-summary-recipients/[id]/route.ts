import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const recipient = await db.dailySummaryRecipient.findFirst({ where: { id, userId: session.user.id } });
  if (!recipient) return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });

  await db.dailySummaryRecipient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
