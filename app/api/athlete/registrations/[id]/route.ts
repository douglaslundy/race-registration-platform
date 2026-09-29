import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pickParticipantChanges } from "@/lib/registrations/participant-identity";
import { getAllowedShirtSizes } from "@/lib/shirt-size-restriction";
import { Prisma } from "@prisma/client";

const schema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(30).nullable().optional(),
    birthDate: z.string().nullable().optional(),
    gender: z.string().max(20).nullable().optional(),
    shirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).nullable().optional(),
    teamName: z.string().max(100).nullable().optional(),
    emergencyContactName: z.string().max(100).nullable().optional(),
    emergencyContactPhone: z.string().max(30).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Informe ao menos um campo" });

/**
 * Deixa o ATLETA corrigir os dados do participante da PRÓPRIA inscrição, mas só
 * enquanto o `registrationEditDeadline` do evento estiver no futuro. Nunca permite
 * alterar `email`/`cpf` (fora do schema) e nunca toca na conta do atleta
 * (nada de db.user.update / db.athleteProfile.*).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const reg = await db.registration.findUnique({
    where: { id },
    select: {
      athleteUserId: true,
      eventId: true,
      shirtSize: true,
      participantName: true,
      participantEmail: true,
      participantPhone: true,
      participantBirthDate: true,
      participantGender: true,
      participantCpf: true,
      ticketBatch: { select: { hasShirt: true } },
      event: {
        select: {
          registrationEditDeadline: true,
          shirtSizeRestrictionDate: true,
          shirtSizeRestrictionSizes: true,
        },
      },
    },
  });
  if (!reg || reg.athleteUserId !== session.user.id) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const deadline = reg.event.registrationEditDeadline;
  if (!deadline || deadline.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "A edição desta inscrição não está disponível." },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.participantName = b.name.trim();
  if (b.phone !== undefined) data.participantPhone = b.phone;
  if (b.gender !== undefined) data.participantGender = b.gender;
  if (b.birthDate !== undefined) {
    if (b.birthDate === null || b.birthDate === "") {
      data.participantBirthDate = null;
    } else {
      const d = new Date(b.birthDate);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
      }
      data.participantBirthDate = d;
    }
  }
  if (b.shirtSize !== undefined) {
    if (!reg.ticketBatch.hasShirt) {
      // Lote não inclui camiseta — ignora qualquer valor enviado, defesa em profundidade
      // já que a UI nem mostra o campo nesse caso.
    } else if (b.shirtSize === null) {
      return NextResponse.json({ error: "Selecione o tamanho de camiseta." }, { status: 400 });
    } else {
      // Só valida restrição por data e quota quando o tamanho realmente muda — manter o
      // tamanho atual nunca falha, mesmo que o evento tenha restringido/esgotado esse tamanho
      // depois que a inscrição foi feita (grandfathering, igual já valia só pra quota antes).
      if (b.shirtSize !== reg.shirtSize) {
        const allowedSizes = getAllowedShirtSizes(reg.event, new Date());
        if (!allowedSizes.includes(b.shirtSize)) {
          return NextResponse.json({ error: "Tamanho de camiseta indisponível para este evento" }, { status: 400 });
        }
        const quota = await db.eventShirtSizeQuota.findUnique({
          where: { eventId_size: { eventId: reg.eventId, size: b.shirtSize } },
        });
        if (quota) {
          const usedCount = await db.registration.count({
            where: { eventId: reg.eventId, shirtSize: b.shirtSize, status: { not: "CANCELLED" } },
          });
          if (usedCount >= quota.quantity) {
            return NextResponse.json({ error: "Tamanho de camiseta esgotado para este evento" }, { status: 400 });
          }
        }
      }
      data.shirtSize = b.shirtSize;
    }
  }
  if (b.teamName !== undefined) data.teamName = b.teamName;
  if (b.emergencyContactName !== undefined) data.emergencyContactName = b.emergencyContactName;
  if (b.emergencyContactPhone !== undefined) data.emergencyContactPhone = b.emergencyContactPhone;

  if (Object.keys(data).length === 0) {
    // Ex.: só veio shirtSize num lote sem camiseta, ignorado acima — nada realmente muda,
    // então não grava update nem auditoria vazios.
    return NextResponse.json({ ok: true });
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
        metadata: { ...changes, by: "athlete" } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
