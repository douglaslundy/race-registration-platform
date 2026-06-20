import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email obrigatório" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalizedEmail } });

  // Sempre retorna sucesso para evitar enumeração de e-mails.
  if (!user) return NextResponse.json({ ok: true });

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hora

  // Remove tokens anteriores deste usuário e cria um novo.
  await db.verificationToken.deleteMany({ where: { identifier: normalizedEmail } });
  await db.verificationToken.create({
    data: { identifier: normalizedEmail, token, expires },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const resetUrl = `${baseUrl}/auth/nova-senha?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;

  if (process.env.NODE_ENV === "development") {
    console.log(`[PASSWORD RESET] ${normalizedEmail} → ${resetUrl}`);
  }

  const cfg = await getSmtpConfig();
  if (isSmtpReady(cfg)) {
    try {
      await sendPasswordResetEmail({ to: normalizedEmail, name: user.name, resetUrl });
    } catch (err) {
      console.error("[forgot-password] email send failed:", err);
      // Não revela o erro ao cliente (evita enumeração / vazamento de config).
    }
  }

  return NextResponse.json({ ok: true });
}
