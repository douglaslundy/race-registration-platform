import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { hasValidMxRecord } from "@/lib/validate-email-domain";

const schema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(2).max(150),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
});

export async function POST(req: NextRequest) {
  const enabled = await getSetting("ads_marketplace_enabled");
  if (enabled !== "true") {
    return NextResponse.json({ error: "Cadastro de anunciantes não está disponível no momento" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password, companyName, contactEmail, contactPhone } = parsed.data;

  if (!(await hasValidMxRecord(email))) {
    return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
  }

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash, role: "ADVERTISER" },
      select: { id: true, name: true, email: true, role: true },
    });

    await tx.advertiserProfile.create({
      data: { userId: user.id, companyName, contactEmail, contactPhone },
    });

    return user;
  });

  return NextResponse.json({ user }, { status: 201 });
}
