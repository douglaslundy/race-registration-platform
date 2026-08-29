import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;

  const body = await req.json().catch(() => ({}));
  const targetId =
    typeof body.targetId === "string" && body.targetId ? body.targetId : "new";

  const result = await requestSensitiveActionCode({
    userId: check.session.user.id,
    actionType: "PAYMENT_ACCOUNT_CHANGE",
    targetId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
