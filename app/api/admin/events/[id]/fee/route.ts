import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

const schema = z
  .object({
    platformFeePercent: z.number().int().min(0).max(5000).optional(),
    pixServiceFeeDiscountPercent: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine(
    (d) => d.platformFeePercent !== undefined || d.pixServiceFeeDiscountPercent !== undefined,
    { message: "Nenhum campo para atualizar" },
  );

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("events.set-fee");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: {
    platformFeePercent?: number;
    pixServiceFeeDiscountPercent?: number | null;
  } = {};
  if (parsed.data.platformFeePercent !== undefined) {
    data.platformFeePercent = parsed.data.platformFeePercent;
  }
  if (parsed.data.pixServiceFeeDiscountPercent !== undefined) {
    data.pixServiceFeeDiscountPercent = parsed.data.pixServiceFeeDiscountPercent;
  }

  const event = await db.event.update({ where: { id }, data });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_FEE_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: data,
    },
  });

  return NextResponse.json({ event });
}
