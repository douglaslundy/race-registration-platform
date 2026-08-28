import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { slugify } from "@/lib/format";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("events.duplicate", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
    include: {
      routes: true,
      categories: true,
      ticketBatches: true,
    },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const newTitle = `${event.title} (Cópia)`;
  const baseSlug = slugify(newTitle);
  let slug = baseSlug;
  let attempt = 0;
  while (await db.event.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  const newEvent = await db.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        organizerId: event.organizerId,
        title: newTitle,
        slug,
        description: event.description,
        modality: event.modality,
        status: "DRAFT",
        startAt: event.startAt,
        kitPickupAt: event.kitPickupAt,
        venueName: event.venueName,
        addressLine: event.addressLine,
        city: event.city,
        state: event.state,
        country: event.country,
        bannerUrl: event.bannerUrl,
        regulationUrl: event.regulationUrl,
        organizerContact: event.organizerContact,
        maxParticipants: event.maxParticipants,
        platformFeePercent: event.platformFeePercent,
        pixServiceFeeDiscountPercent: event.pixServiceFeeDiscountPercent,
      },
    });

    if (event.routes.length > 0) {
      await tx.eventRoute.createMany({
        data: event.routes.map(({ id: _id, eventId: _eid, ...r }) => ({ ...r, eventId: created.id })),
      });
    }
    if (event.categories.length > 0) {
      await tx.eventCategory.createMany({
        data: event.categories.map(({ id: _id, eventId: _eid, ...c }) => ({ ...c, eventId: created.id })),
      });
    }
    if (event.ticketBatches.length > 0) {
      await tx.ticketBatch.createMany({
        data: event.ticketBatches.map(({ id: _id, eventId: _eid, soldCount: _sc, createdAt: _ca, ...b }) => ({
          ...b,
          soldCount: 0,
          eventId: created.id,
        })),
      });
    }

    return created;
  });

  return NextResponse.json({ eventId: newEvent.id }, { status: 201 });
}
