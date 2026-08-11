import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.cancellation-decision");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const hasPaidPayment = await registrationHasPaidPayment({ id, event: { organizerId: scope.organizerId ?? "__none__" } });
  if (!hasPaidPayment) {
    return NextResponse.json({ error: "Esta inscrição não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "REGISTRATION_CANCELLATION_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
