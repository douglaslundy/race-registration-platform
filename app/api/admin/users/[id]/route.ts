import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  role: z.enum(["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id },
    data: parsed.data,
    select: { id: true, role: true, active: true },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: parsed.data.role ? "USER_ROLE_CHANGED" : "USER_ACTIVE_TOGGLED",
      entityType: "User",
      entityId: id,
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ user });
}
