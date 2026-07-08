import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import { decideCancellationOutcome } from "@/lib/registrations/cancellation-policy";
import { notifyCancellationRequested } from "@/lib/alerts/cancellation-requested";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          startAt: true,
          title: true,
          cancellationDeadline: true,
          cancellationRequiresApproval: true,
          cancellationContactEmail: true,
        },
      },
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

  if (!reason) {
    return NextResponse.json({ error: "Justificativa obrigatória para cancelar a inscrição" }, { status: 400 });
  }

  const policyEnabled = await getCancellationPolicyEnabled();
  const decision = decideCancellationOutcome({
    policyEnabled,
    cancellationDeadline: registration.event.cancellationDeadline,
    cancellationRequiresApproval: registration.event.cancellationRequiresApproval,
    now: new Date(),
  });

  if (decision.outcome === "blocked_deadline_passed") {
    return NextResponse.json({ error: "Prazo de cancelamento encerrado" }, { status: 400 });
  }

  if (decision.outcome === "requires_approval") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: {
          status: "CANCELLATION_REQUESTED",
          cancellationReason: reason,
          cancellationRequestedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_REQUESTED",
          entityType: "Registration",
          entityId: id,
          metadata: { eventTitle: registration.event.title, reason },
        },
      });
    });

    void notifyCancellationRequested(id);

    return NextResponse.json({ success: true, status: "CANCELLATION_REQUESTED" });
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id },
      data: { status: "CANCELLED", cancellationReason: reason },
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
        metadata: { eventTitle: registration.event.title, orderId: registration.order.id, reason },
      },
    });
  });

  return NextResponse.json({ success: true });
}
