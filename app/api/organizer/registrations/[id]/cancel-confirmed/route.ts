import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { cancelConfirmedRegistrationDirectly } from "@/lib/registrations/cancellation-decision-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.cancel-confirmed");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "Justificativa obrigatória para cancelar a inscrição" }, { status: 400 });
  }

  const { verificationId, code } = body;
  if (typeof verificationId !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
  }
  const verification = await verifySensitiveActionCode({
    verificationId,
    userId: session.user.id,
    actionType: "REGISTRATION_CANCEL_CONFIRMED",
    targetId: id,
    code,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const result = await cancelConfirmedRegistrationDirectly({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    reason,
    actingUserId: session.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "REGISTRATION_CANCELLED_BY_ORGANIZER",
      entityType: "Registration",
      entityId: id,
      metadata: { reason, refund: result.refund },
    },
  });

  return NextResponse.json({ success: true, refund: result.refund });
}
