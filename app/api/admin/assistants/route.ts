import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  actionKeys: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await createOrPromoteAssistant({
    email: parsed.data.email,
    name: parsed.data.name,
    actionKeys: parsed.data.actionKeys,
    createdByUserId: session.user.id,
    invitedByName: session.user.name,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ userId: result.userId, isNew: result.isNew }, { status: 201 });
}
