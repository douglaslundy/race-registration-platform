import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const { id, couponId } = await params;
  const check = await checkApiPermission("coupons.edit", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCoupon = await db.coupon.findFirst({ where: { id: couponId, eventId: id } });
  if (!existingCoupon) return NextResponse.json({ error: "Cupom não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { maxUses, expiresAt } = parsed.data;
  const coupon = await db.coupon.update({
    where: { id: couponId },
    data: {
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    },
  });
  return NextResponse.json({ coupon });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const { id, couponId } = await params;
  const check = await checkApiPermission("coupons.delete", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCoupon = await db.coupon.findFirst({ where: { id: couponId, eventId: id } });
  if (!existingCoupon) return NextResponse.json({ error: "Cupom não encontrado" }, { status: 404 });

  // Não excluir cupom já utilizado em pedidos (mantém o histórico de rastreamento).
  const usedInOrder = await db.order.findFirst({ where: { couponId }, select: { id: true } });
  if (usedInOrder) {
    return NextResponse.json(
      { error: "Cupom já utilizado em pedidos. Ajuste o limite de usos ou a validade em vez de excluir." },
      { status: 409 }
    );
  }

  await db.coupon.delete({ where: { id: couponId } });
  return NextResponse.json({ success: true });
}
