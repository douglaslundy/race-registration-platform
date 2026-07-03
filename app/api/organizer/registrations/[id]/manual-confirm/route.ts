import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyOrderConfirmed } from "@/lib/notifications";

const schema = z.object({
  reason: z.string(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe uma justificativa" }, { status: 400 });
  }

  const reason = parsed.data.reason.trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: "Justifique o motivo da confirmação manual" }, { status: 400 });
  }

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: {
      id: true,
      status: true,
      order: {
        select: {
          id: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "PENDING_PAYMENT") {
    return NextResponse.json({ error: "Esta inscrição não está aguardando pagamento" }, { status: 400 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento encontrado para esta inscrição" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "PAID" },
    });

    await tx.registration.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_MANUALLY_CONFIRMED",
        entityType: "Registration",
        entityId: id,
        metadata: { reason },
      },
    });
  });

  void notifyOrderConfirmed(registration.order.id);

  return NextResponse.json({ success: true });
}
