import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { decideRegistrationCancellation, registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancellation-decision-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.decision === "APPROVE" && (await registrationHasPaidPayment({ id }))) {
    const { verificationId, code } = body;
    if (typeof verificationId !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
    }
    const verification = await verifySensitiveActionCode({
      verificationId,
      userId: session.user.id,
      actionType: "PAYMENT_REFUND",
      targetId: id,
      code,
    });
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
    }
  }

  const result = await decideRegistrationCancellation({
    where: { id },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, refund: result.refund });
}
