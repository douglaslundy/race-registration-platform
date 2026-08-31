import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

/**
 * IMPORTANTE: esta rota edita o CADASTRO DO ATLETA — `User` + `AthleteProfile` (a conta,
 * que é compartilhada entre todas as inscrições daquele atleta). NÃO edita os dados
 * congelados de UMA inscrição.
 *
 * Para corrigir os dados de uma inscrição específica (o snapshot `Registration.participant*`),
 * use `PATCH /api/organizer/registrations/[id]` (organizador) ou
 * `PATCH /api/admin/registrations/[id]` (admin) — essas rotas nunca tocam `User`/`AthleteProfile`.
 *
 * Na UI: o botão "Editar cadastro do atleta" do modal de inscritos aponta pra cá; o botão
 * "Corrigir dados desta inscrição" aponta pra rota do snapshot.
 */

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
  phone: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.edit-athlete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const scope = await resolveActingScope(session);
  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    select: { athleteUserId: true },
  });
  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const userId = registration.athleteUserId;
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const incomingEmail = parsed.data.email?.toLowerCase();
  if (incomingEmail && incomingEmail !== existing.email) {
    const emailExists = await db.user.findUnique({ where: { email: incomingEmail } });
    if (emailExists && emailExists.id !== userId) {
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
      where: { cpf: normalizedCpf, userId: { not: userId } },
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

  const athleteData: Record<string, unknown> = {};
  if (normalizedCpf) athleteData.cpf = normalizedCpf;
  if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);
  if (parsed.data.phone !== undefined) athleteData.phone = parsed.data.phone;
  if (parsed.data.gender !== undefined) athleteData.gender = parsed.data.gender;
  if (parsed.data.city !== undefined) athleteData.city = parsed.data.city;
  if (parsed.data.state !== undefined) athleteData.state = parsed.data.state;
  if (parsed.data.teamName !== undefined) athleteData.teamName = parsed.data.teamName;
  if (parsed.data.preferredShirtSize !== undefined) {
    athleteData.preferredShirtSize = parsed.data.preferredShirtSize;
  }

  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const updatedUser =
        Object.keys(data).length > 0
          ? await tx.user.update({
              where: { id: userId },
              data,
              select: { id: true, name: true, email: true },
            })
          : { id: userId, name: existing.name, email: existing.email };

      if (Object.keys(athleteData).length > 0) {
        await tx.athleteProfile.upsert({
          where: { userId },
          create: { userId, ...athleteData },
          update: athleteData,
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: userId,
          metadata: { ...data, ...athleteData } as Prisma.InputJsonValue,
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
