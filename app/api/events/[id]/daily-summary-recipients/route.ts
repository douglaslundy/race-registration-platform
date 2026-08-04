import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

const schema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório"),
    type: z.enum(["EMAIL", "WHATSAPP"]),
    value: z.string().min(1, "Valor é obrigatório"),
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

async function checkEventAccess(eventId: string) {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (!["ADMIN", "ORGANIZER", "ASSISTANT"].includes(session.user.role)) {
    return { allowed: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
  }
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({
    where: scope.actingAsAdmin ? { id: eventId } : { id: eventId, organizer: { userId: session.user.id } },
    select: { id: true, organizer: { select: { userId: true } } },
  });
  if (!event) {
    return { allowed: false as const, response: NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }) };
  }
  return { allowed: true as const, session, event };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkEventAccess(id);
  if (!check.allowed) return check.response;

  const recipients = await db.dailySummaryRecipient.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, type: true, value: true },
  });
  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkEventAccess(id);
  if (!check.allowed) return check.response;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const value = parsed.data.type === "WHATSAPP" ? parsed.data.value.replace(/\D/g, "") : parsed.data.value;

  // userId sempre aponta pro organizador dono do evento — mesmo quando é o admin quem cadastra,
  // preservando "esse contato pertence ao dono do evento" (mesma regra dos contatos agregados).
  const recipient = await db.dailySummaryRecipient.create({
    data: { userId: check.event.organizer.userId, eventId: id, name: parsed.data.name, type: parsed.data.type, value },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipient }, { status: 201 });
}
