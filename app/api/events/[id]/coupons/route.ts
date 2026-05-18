import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const couponSchema = z.object({
  code: z.string().min(3).toUpperCase(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().positive(),
  maxUses: z.number().int().positive().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coupons = await db.coupon.findMany({ where: { eventId: id } });
  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await db.coupon.findFirst({ where: { eventId: id, code: parsed.data.code } });
  if (existing) return NextResponse.json({ error: "Código já existe neste evento" }, { status: 409 });

  const coupon = await db.coupon.create({
    data: {
      eventId: id,
      ...parsed.data,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  return NextResponse.json({ coupon }, { status: 201 });
}
