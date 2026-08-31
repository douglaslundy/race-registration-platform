import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { sendPasswordChangedEmail } from "@/lib/email";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // M9: sem rate-limit dava pra ficar tentando adivinhar a currentPassword online.
  const { allowed } = checkRateLimit(
    `change-password:${session.user.id}:${getClientIp(req)}`,
    RATE_LIMITS.AUTH,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde um minuto e tente novamente." },
      { status: 429 },
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message ?? "Dados inválidos";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });

  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  // M9: bump passwordChangedAt — o callback jwt invalida tokens emitidos antes deste instante,
  // então um token roubado não sobrevive à troca de senha.
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hash, passwordChangedAt: new Date() },
  });

  // Best-effort — não bloqueia a resposta se o e-mail falhar.
  void sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) => {
    console.error("[change-password] falha ao enviar aviso de senha alterada:", err);
  });

  return NextResponse.json({ ok: true });
}
