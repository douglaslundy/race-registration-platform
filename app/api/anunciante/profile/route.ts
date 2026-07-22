import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { z } from "zod";

const profileSchema = z.object({
  companyName: z.string().min(1, "Informe a razão social"),
  contactEmail: z.string().email("E-mail inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
});

export async function GET() {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;

  return NextResponse.json({ profile: check.advertiser });
}

export async function PUT(req: NextRequest) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const profile = await db.advertiserProfile.upsert({
    where: { userId: check.session.user.id },
    create: { userId: check.session.user.id, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json({ profile });
}
