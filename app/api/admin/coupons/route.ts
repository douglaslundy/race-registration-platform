import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const couponSchema = z.object({
  code: z.string().trim().min(3).toUpperCase(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  // PERCENT: inteiro (10 = 10%); FIXED: centavos
  discountValue: z.number().int().positive(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  // null/ausente = cupom global (vale para todos os eventos)
  eventId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("coupons.create-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const body = await req.json();
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { code, discountType, discountValue, maxUses, expiresAt, eventId } = parsed.data;
  const normalizedEventId = eventId ?? null;

  if (discountType === "PERCENT" && discountValue > 100) {
    return NextResponse.json({ error: "Desconto percentual não pode passar de 100%" }, { status: 400 });
  }

  if (normalizedEventId) {
    const event = await db.event.findUnique({ where: { id: normalizedEventId }, select: { id: true } });
    if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }

  const existing = await db.coupon.findFirst({
    where: { eventId: normalizedEventId, code },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: normalizedEventId ? "Código já existe neste evento" : "Já existe um cupom global com este código" },
      { status: 409 }
    );
  }

  const coupon = await db.coupon.create({
    data: {
      eventId: normalizedEventId,
      code,
      discountType,
      discountValue,
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdById: session.user.id,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "COUPON_CREATED",
      entityType: "Coupon",
      entityId: coupon.id,
      metadata: { code, discountType, discountValue, eventId: normalizedEventId },
    },
  });

  return NextResponse.json({ coupon }, { status: 201 });
}
