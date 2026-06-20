import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  active: z.boolean(),
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

  const coupon = await db.coupon.update({
    where: { id },
    data: { active: parsed.data.active },
  });

  return NextResponse.json({ coupon });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

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
