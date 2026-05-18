import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  platformFeePercent: z.number().int().min(0).max(5000),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const event = await db.event.update({
    where: { id },
    data: { platformFeePercent: parsed.data.platformFeePercent },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_FEE_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: { platformFeePercent: parsed.data.platformFeePercent },
    },
  });

  return NextResponse.json({ event });
}
