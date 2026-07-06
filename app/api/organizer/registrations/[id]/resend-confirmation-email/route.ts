import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyOrderConfirmed } from "@/lib/notifications";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { id: true, status: true, order: { select: { id: true } } },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Esta inscrição ainda não está confirmada" }, { status: 400 });
  }

  await notifyOrderConfirmed(registration.order.id);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CONFIRMATION_EMAIL_RESENT",
      entityType: "Registration",
      entityId: registration.id,
      metadata: { orderId: registration.order.id },
    },
  });

  return NextResponse.json({ success: true });
}
