import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getBatchStatus } from "@/lib/batch-status";

const batchSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  priceAmount: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  activationMode: z.enum(["MANUAL", "DATE", "AFTER_PREVIOUS"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("batches.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
  const body = await req.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const batch = await db.ticketBatch.create({
    data: {
      ...parsed.data,
      eventId,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      activationMode: parsed.data.activationMode ?? "MANUAL",
    },
  });

  return NextResponse.json({ batch }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const batches = await db.ticketBatch.findMany({
    where: { eventId },
    orderBy: { startAt: "asc" },
  });
  const batchesWithStatus = batches.map((batch) => ({
    ...batch,
    status: getBatchStatus(batch, batches),
  }));
  return NextResponse.json({ batches: batchesWithStatus });
}
