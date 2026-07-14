import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.reject");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  await db.event.update({
    where: { id },
    data: { status: "DRAFT" },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_REJECTED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
