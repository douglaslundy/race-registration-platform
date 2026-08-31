import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { hashVerificationToken } from "@/lib/auth/verification-token";
import { zodErrorResponse } from "@/lib/http/zod-error";

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

export async function POST(req: NextRequest) {
  const { allowed } = checkRateLimit(`reset-password:${getClientIp(req)}`, RATE_LIMITS.AUTH);
  if (!allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto e tente novamente." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return zodErrorResponse(parsed.error);

  const { password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const tokenHash = hashVerificationToken(parsed.data.token);

  const record = await db.verificationToken.findUnique({ where: { token: tokenHash } });

  if (!record || record.identifier !== email) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  if (record.expires < new Date()) {
    await db.verificationToken.delete({ where: { token: tokenHash } });
    return NextResponse.json({ error: "Token expirado. Solicite uma nova recuperação." }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  await db.$transaction([
    db.user.update({ where: { email }, data: { passwordHash: hash } }),
    db.verificationToken.delete({ where: { token: tokenHash } }),
  ]);

  return NextResponse.json({ ok: true });
}
