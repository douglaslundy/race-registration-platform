import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { email, token, password } = parsed.data;

  const record = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token: "reset" } },
  });

  if (!record || record.token !== token) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  if (record.expires < new Date()) {
    await db.verificationToken.delete({ where: { identifier_token: { identifier: email, token: "reset" } } });
    return NextResponse.json({ error: "Token expirado. Solicite uma nova recuperação." }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);

  await db.$transaction([
    db.user.update({ where: { email }, data: { passwordHash: hash } }),
    db.verificationToken.delete({ where: { identifier_token: { identifier: email, token: "reset" } } }),
  ]);

  return NextResponse.json({ ok: true });
}
