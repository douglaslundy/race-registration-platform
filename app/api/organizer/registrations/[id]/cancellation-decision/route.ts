import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { id: true, status: true, ticketBatchId: true, orderId: true },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "CANCELLATION_REQUESTED") {
    return NextResponse.json(
      { error: "Esta inscrição não possui uma solicitação de cancelamento pendente" },
      { status: 400 },
    );
  }

  if (parsed.data.decision === "APPROVE") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      await tx.order.update({
        where: { id: registration.orderId },
        data: { status: "CANCELLED" },
      });

      await tx.ticketBatch.update({
        where: { id: registration.ticketBatchId },
        data: { soldCount: { decrement: 1 } },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_APPROVED",
          entityType: "Registration",
          entityId: id,
        },
      });
    });
  } else {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: { status: "CONFIRMED" },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_REJECTED",
          entityType: "Registration",
          entityId: id,
        },
      });
    });
  }

  return NextResponse.json({ success: true });
}
