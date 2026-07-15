import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  active: z.boolean().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("coupons.edit-any");
  if (!check.allowed) return check.response;

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { active, maxUses, expiresAt } = parsed.data;
  const coupon = await db.coupon.update({
    where: { id },
    data: {
      ...(active !== undefined ? { active } : {}),
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    },
  });

  return NextResponse.json({ coupon });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("coupons.delete-any");
  if (!check.allowed) return check.response;

  const { id } = await params;

  // Não excluir cupom já utilizado em pedidos (mantém o histórico de rastreamento).
  const usedInOrder = await db.order.findFirst({ where: { couponId: id }, select: { id: true } });
  if (usedInOrder) {
    return NextResponse.json(
      { error: "Cupom já utilizado em pedidos. Desative-o em vez de excluir." },
      { status: 409 }
    );
  }

  await db.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
