import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const couponSchema = z
  .object({
    code: z.string().trim().min(3).toUpperCase(),
    discountType: z.enum(["PERCENT", "FIXED"]),
    // PERCENT: inteiro (10 = 10%, máx. 100); FIXED: centavos
    discountValue: z.number().int().positive(),
    maxUses: z.number().int().positive().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
  })
  .refine((d) => d.discountType !== "PERCENT" || d.discountValue <= 100, {
    message: "Desconto percentual não pode passar de 100%",
    path: ["discountValue"],
  });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("coupons.view", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const coupons = await db.coupon.findMany({ where: { eventId: id } });
  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("coupons.create", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
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
      createdById: session.user.id,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  return NextResponse.json({ coupon }, { status: 201 });
}
