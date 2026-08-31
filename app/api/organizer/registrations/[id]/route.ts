import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { pickParticipantChanges } from "@/lib/registrations/participant-identity";
import { Prisma } from "@prisma/client";

const schema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).nullable().optional(),
    birthDate: z.string().optional(),
    gender: z.string().max(20).nullable().optional(),
    cpf: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Informe ao menos um campo" });

/**
 * Corrige o snapshot de dados do participante de UMA inscrição — nunca toca na conta
 * do atleta (nada de db.user.update / db.athleteProfile.update). É o complemento da
 * rota `/athlete`, que edita a conta.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const reg = await db.registration.findUnique({
    where: { id },
    select: {
      eventId: true,
      participantName: true,
      participantEmail: true,
      participantPhone: true,
      participantBirthDate: true,
      participantGender: true,
      participantCpf: true,
      event: { select: { organizerId: true } },
    },
  });
  if (!reg) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  const check = await checkApiPermission("registrations.edit-athlete", { eventId: reg.eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  if (!scope.actingAsAdmin && reg.event.organizerId !== scope.organizerId) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.participantName = b.name.trim();
  if (b.email !== undefined) data.participantEmail = b.email.trim().toLowerCase();
  if (b.phone !== undefined) data.participantPhone = b.phone;
  if (b.gender !== undefined) data.participantGender = b.gender;
  if (b.birthDate !== undefined) {
    const d = new Date(b.birthDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
    }
    data.participantBirthDate = d;
  }
  if (b.cpf !== undefined) {
    const c = normalizeCpf(b.cpf);
    if (!isValidCpf(c)) return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    data.participantCpf = c;
  }

  const changes = pickParticipantChanges(reg as Record<string, unknown>, { ...reg, ...data });

  await db.$transaction([
    db.registration.update({ where: { id }, data: data as Prisma.RegistrationUpdateInput }),
    db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_PARTICIPANT_UPDATED",
        entityType: "Registration",
        entityId: id,
        metadata: changes as Prisma.InputJsonValue,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
