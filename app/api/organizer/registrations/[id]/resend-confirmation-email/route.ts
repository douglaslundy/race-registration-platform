import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notifyOrderConfirmed } from "@/lib/notifications";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.resend-confirmation-email");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    select: { id: true, status: true, order: { select: { id: true } } },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Esta inscrição ainda não está confirmada" }, { status: 400 });
  }

  await notifyOrderConfirmed(registration.order.id, { bypassDedupe: true });

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
