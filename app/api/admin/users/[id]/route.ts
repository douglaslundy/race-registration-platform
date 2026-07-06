import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const roleSchema = z.enum(["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"]);

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const incomingEmail = parsed.data.email?.toLowerCase();
  if (incomingEmail && incomingEmail !== existing.email) {
    const emailExists = await db.user.findUnique({ where: { email: incomingEmail } });
    if (emailExists && emailExists.id !== id) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }
  }

  let normalizedCpf: string | undefined;
  if (parsed.data.cpf) {
    normalizedCpf = normalizeCpf(parsed.data.cpf);
    if (!isValidCpf(normalizedCpf)) {
      return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    }
    const cpfTaken = await db.athleteProfile.findFirst({
      where: { cpf: normalizedCpf, userId: { not: id } },
    });
    if (cpfTaken) {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
  }

  if (parsed.data.birthDate && Number.isNaN(new Date(parsed.data.birthDate).getTime())) {
    return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (incomingEmail) data.email = incomingEmail;
  if (parsed.data.role) data.role = parsed.data.role;
  if (typeof parsed.data.active === "boolean") data.active = parsed.data.active;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12);

  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      });

      if (normalizedCpf || parsed.data.birthDate) {
        const athleteData: Record<string, unknown> = {};
        if (normalizedCpf) athleteData.cpf = normalizedCpf;
        if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);

        await tx.athleteProfile.upsert({
          where: { userId: id },
          create: { userId: id, ...athleteData },
          update: athleteData,
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: id,
          metadata: {
            ...data,
            ...(normalizedCpf ? { cpf: normalizedCpf } : {}),
            ...(parsed.data.birthDate ? { birthDate: parsed.data.birthDate } : {}),
            passwordHash: parsed.data.password ? "[redacted]" : undefined,
          },
        },
      });

      return updatedUser;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ user });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  if (session.user.id === id) {
    return NextResponse.json({ error: "Você não pode excluir a sua própria conta" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const [orders, registrations] = await Promise.all([
    db.order.count({ where: { buyerUserId: id } }),
    db.registration.count({ where: { athleteUserId: id } }),
  ]);

  if (orders > 0 || registrations > 0) {
    return NextResponse.json(
      {
        error:
          "Usuários com pedidos ou inscrições vinculados não podem ser excluídos. Desative a conta em vez disso.",
      },
      { status: 409 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.auditLog.updateMany({
      where: { userId: id },
      data: { userId: null },
    });

    await tx.user.delete({ where: { id } });
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "USER_DELETED",
      entityType: "User",
      entityId: id,
      metadata: { id, email: user.email, name: user.name },
    },
  });

  return NextResponse.json({ ok: true });
}
