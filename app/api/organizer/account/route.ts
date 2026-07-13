import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().nullable(),
  cpf: z.string().max(14).optional().nullable(),
  dailySummaryEmailEnabled: z.boolean(),
  dailySummaryWhatsappEnabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      cpf: parsed.data.cpf || null,
      dailySummaryEmailEnabled: parsed.data.dailySummaryEmailEnabled,
      dailySummaryWhatsappEnabled: parsed.data.dailySummaryWhatsappEnabled,
    },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}
