import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { id } = await params;

  const result = await requestSensitiveActionCode({
    userId: check.session.user.id,
    actionType: "PAYMENT_ACCOUNT_CHANGE",
    targetId: id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
