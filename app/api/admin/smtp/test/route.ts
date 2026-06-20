import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendTestEmail } from "@/lib/email";
import { z } from "zod";

const schema = z.object({
  to: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "E-mail de destino inválido" }, { status: 400 });
  }

  let to = parsed.data.to;
  if (!to) {
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
    to = user?.email ?? undefined;
  }
  if (!to) {
    return NextResponse.json({ error: "Informe um e-mail de destino" }, { status: 400 });
  }

  try {
    await sendTestEmail(to);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao enviar e-mail de teste";
    console.error("[smtp/test] failed:", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to });
}
