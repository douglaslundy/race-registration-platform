import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancellation-decision-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const hasPaidPayment = await registrationHasPaidPayment({ id });
  if (!hasPaidPayment) {
    return NextResponse.json({ error: "Esta inscrição não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "REGISTRATION_CANCELLATION_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
