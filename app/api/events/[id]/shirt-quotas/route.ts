import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { zodErrorResponse } from "@/lib/http/zod-error";
import { getShirtSizeAvailability } from "@/lib/shirt-size-quota";

const putSchema = z.object({
  quotas: z
    .array(
      z.object({
        size: z.enum(["PP", "P", "M", "G", "GG", "XGG"]),
        quantity: z.number().int().min(0).nullable(),
      }),
    )
    .refine((quotas) => new Set(quotas.map((q) => q.size)).size === quotas.length, {
      message: "Tamanho duplicado na lista de quotas",
    }),
});

async function getOwnedEvent(eventId: string, organizerId: string | null, actingAsAdmin: boolean) {
  return actingAsAdmin
    ? db.event.findUnique({ where: { id: eventId } })
    : db.event.findFirst({ where: { id: eventId, organizerId: organizerId ?? "__none__" } });
}

async function getQuotasWithUsage(eventId: string) {
  const availability = await getShirtSizeAvailability(eventId);
  return availability.map(({ size, quantity, usedCount }) => ({ size, quantity, usedCount }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const check = await checkApiPermission("events.edit", { eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await getOwnedEvent(eventId, scope.organizerId ?? null, scope.actingAsAdmin);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  return NextResponse.json({ quotas: await getQuotasWithUsage(eventId) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const check = await checkApiPermission("events.edit", { eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await getOwnedEvent(eventId, scope.organizerId ?? null, scope.actingAsAdmin);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErrorResponse(parsed.error);

  const rowsToCreate = parsed.data.quotas
    .filter((q) => q.quantity !== null)
    .map((q) => ({ eventId, size: q.size, quantity: q.quantity as number }));

  await db.$transaction([
    db.eventShirtSizeQuota.deleteMany({ where: { eventId } }),
    db.eventShirtSizeQuota.createMany({ data: rowsToCreate }),
  ]);

  return NextResponse.json({ quotas: await getQuotasWithUsage(eventId) });
}
