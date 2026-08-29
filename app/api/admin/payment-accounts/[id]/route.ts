import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { maskCredential, updatePaymentAccount } from "@/lib/payment/payment-accounts";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { session } = check;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const verified = await verify2faBody(session, "PAYMENT_ACCOUNT_CHANGE", id, body);
  if (!verified.ok) return verified.response;

  const patch: {
    label?: string;
    accessToken?: string;
    webhookSecret?: string;
    publicKey?: string | null;
  } = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.accessToken === "string") patch.accessToken = body.accessToken;
  if (typeof body.webhookSecret === "string") patch.webhookSecret = body.webhookSecret;
  if (typeof body.publicKey === "string") patch.publicKey = body.publicKey;

  await updatePaymentAccount(id, patch);

  const metadata: Record<string, string | null> = {};
  if (patch.label !== undefined) metadata.label = patch.label;
  if (patch.accessToken !== undefined) metadata.accessToken = maskCredential(patch.accessToken);
  if (patch.webhookSecret !== undefined) {
    metadata.webhookSecret = maskCredential(patch.webhookSecret);
  }
  if (patch.publicKey !== undefined) metadata.publicKey = maskCredential(patch.publicKey);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAYMENT_ACCOUNT_UPDATED",
      entityType: "PaymentAccount",
      entityId: id,
      metadata,
    },
  });

  return NextResponse.json({ success: true });
}
