import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: { select: { startAt: true, title: true } },
      order: { select: { id: true, status: true } },
    },
  });

  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Somente inscrições confirmadas podem ser canceladas" }, { status: 400 });
  }

  if (new Date(registration.event.startAt) <= new Date()) {
    return NextResponse.json({ error: "Não é possível cancelar após o início do evento" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "CANCELLED" },
    });

    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_CANCELLED",
        entityType: "Registration",
        entityId: id,
        metadata: { eventTitle: registration.event.title, orderId: registration.order.id },
      },
    });
  });

  return NextResponse.json({ success: true });
}
