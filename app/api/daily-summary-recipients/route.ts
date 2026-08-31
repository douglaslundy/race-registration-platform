import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório").max(120), // L9
    type: z.enum(["EMAIL", "WHATSAPP"]),
    value: z.string().min(1, "Valor é obrigatório").max(320),
  })
  .superRefine((data, ctx) => {
    if (data.type === "EMAIL") {
      if (!z.string().email().safeParse(data.value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "E-mail inválido" });
      }
    } else {
      const digits = data.value.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Informe DDD + número (10 ou 11 dígitos, sem +55)",
        });
      }
    }
  });

function canManageRecipients(role?: string): boolean {
  return role === "ADMIN" || role === "ORGANIZER";
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canManageRecipients(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const recipients = await db.dailySummaryRecipient.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canManageRecipients(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const value = parsed.data.type === "WHATSAPP" ? parsed.data.value.replace(/\D/g, "") : parsed.data.value;

  const recipient = await db.dailySummaryRecipient.create({
    data: { userId: session.user.id, name: parsed.data.name, type: parsed.data.type, value },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipient }, { status: 201 });
}
