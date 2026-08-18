import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { deleteObject } from "@/lib/s3";

const updateEventSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]).optional(),
  startAt: z.string().datetime().optional(),
  kitPickupAt: z.string().datetime().optional().nullable(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2).optional(),
  state: z.string().length(2).optional(),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional().nullable(),
  sponsorLink: z.string().optional().nullable(),
  organizerNameOverride: z.string().optional().nullable(),
  organizerDescriptionOverride: z.string().optional().nullable(),
  organizerEmailOverride: z.string().optional().nullable(),
  organizerPhoneOverride: z.string().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  listBannerUrl: z.string().url().optional().nullable(),
  regulationUrl: z.string().url().optional().nullable(),
  regulationText: z.string().optional().nullable(),
  metaTitle: z.string().max(70).optional().nullable(),
  metaDescription: z.string().max(160).optional().nullable(),
  status: z.enum(["DRAFT", "UNDER_REVIEW"]).optional(),
  cancellationDeadline: z.string().datetime().optional().nullable(),
  cancellationRequiresApproval: z.boolean().optional(),
  cancellationContactPhone: z.string().optional().nullable(),
  cancellationContactEmail: z.string().optional().nullable(),
  allowProxyRegistration: z.boolean().optional(),
  shirtSizeRestrictionDate: z.string().datetime().optional().nullable(),
  shirtSizeRestrictionSizes: z.array(z.enum(["PP", "P", "M", "G", "GG", "XGG"])).optional(),
});

async function getEventAndVerifyOwnerByOrganizerId(eventId: string, organizerId: string) {
  return db.event.findFirst({ where: { id: eventId, organizerId } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await getEventAndVerifyOwnerByOrganizerId(id, scope.organizerId)
      : null;

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const updated = await db.event.update({
    where: { id },
    data: {
      ...parsed.data,
      maxParticipants: parsed.data.maxParticipants === 0 ? null : parsed.data.maxParticipants,
      ...(parsed.data.startAt ? { startAt: new Date(parsed.data.startAt) } : {}),
      ...(parsed.data.kitPickupAt !== undefined ? { kitPickupAt: parsed.data.kitPickupAt ? new Date(parsed.data.kitPickupAt) : null } : {}),
      ...(parsed.data.cancellationDeadline !== undefined ? { cancellationDeadline: parsed.data.cancellationDeadline ? new Date(parsed.data.cancellationDeadline) : null } : {}),
      ...(parsed.data.shirtSizeRestrictionDate !== undefined ? { shirtSizeRestrictionDate: parsed.data.shirtSizeRestrictionDate ? new Date(parsed.data.shirtSizeRestrictionDate) : null } : {}),
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ event: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await getEventAndVerifyOwnerByOrganizerId(id, scope.organizerId)
      : null;

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!["DRAFT", "CANCELLED"].includes(event.status)) {
    return NextResponse.json({ error: "Só é possível excluir eventos em rascunho ou cancelados" }, { status: 409 });
  }

  const [registrationsCount, ordersCount, payoutsCount, importsCount] = await Promise.all([
    db.registration.count({ where: { eventId: id } }),
    db.order.count({ where: { eventId: id } }),
    db.transferPayout.count({ where: { eventId: id } }),
    db.resultImport.count({ where: { eventId: id } }),
  ]);

  if (registrationsCount > 0 || ordersCount > 0 || payoutsCount > 0 || importsCount > 0) {
    return NextResponse.json({
      error: "Não é possível excluir um evento com inscrições, pedidos, repasses ou importações vinculadas.",
    }, { status: 409 });
  }

  const fileAssets = await db.fileAsset.findMany({
    where: { eventId: id },
    select: { fileKey: true },
  });

  await db.$transaction(async (tx) => {
    await tx.fileAsset.deleteMany({ where: { eventId: id } });
    await tx.event.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "EVENT_DELETED",
        entityType: "Event",
        entityId: id,
      },
    });
  });

  await Promise.allSettled(fileAssets.map((asset) => deleteObject(asset.fileKey)));

  return NextResponse.json({ ok: true });
}
