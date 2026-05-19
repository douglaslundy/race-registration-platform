import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAppName } from "@/lib/settings";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Email obrigatório" }, { status: 400 });

  const user = await db.user.findUnique({ where: { email } });

  // Always return success to avoid email enumeration
  if (!user) return NextResponse.json({ ok: true });

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  await db.verificationToken.upsert({
    where: { identifier_token: { identifier: email, token: "reset" } },
    update: { token, expires },
    create: { identifier: email, token, expires },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/auth/nova-senha?token=${token}&email=${encodeURIComponent(email)}`;
  const appName = await getAppName();

  if (process.env.NODE_ENV === "development") {
    console.log(`[PASSWORD RESET] ${email} → ${resetUrl}`);
  } else if (process.env.SMTP_HOST) {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? "noreply@example.com",
      to: email,
      subject: `Recuperação de senha — ${appName}`,
      html: `<p>Clique no link para redefinir sua senha (válido por 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
