import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const profileSchema = z.object({
  birthDate: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  medicalNotes: z.string().optional().nullable(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).optional().nullable(),
  teamName: z.string().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const profile = await db.athleteProfile.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ profile });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { cpf: incomingCpf, ...rest } = parsed.data;

  const existing = await db.athleteProfile.findUnique({
    where: { userId: session.user.id },
    select: { cpf: true },
  });

  const data: Record<string, unknown> = { ...rest };
  if (rest.birthDate !== undefined) {
    data.birthDate = rest.birthDate ? new Date(rest.birthDate) : null;
  }

  if (!existing?.cpf && incomingCpf) {
    const normalized = normalizeCpf(incomingCpf);
    if (!isValidCpf(normalized)) {
      return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    }
    const taken = await db.athleteProfile.findFirst({
      where: { cpf: normalized, userId: { not: session.user.id } },
    });
    if (taken) {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
    data.cpf = normalized;
  }

  try {
    const profile = await db.athleteProfile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    });

    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
    throw error;
  }
}
