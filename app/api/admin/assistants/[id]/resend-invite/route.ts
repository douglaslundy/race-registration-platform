import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resendAssistantInvite } from "@/lib/assistants/manage";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const result = await resendAssistantInvite({ assistantId: id, invitedByName: session.user.name });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ASSISTANT_INVITE_RESENT",
      entityType: "User",
      entityId: id,
      metadata: {},
    },
  });
  return NextResponse.json({ ok: true });
}
