import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import {
  createPaymentAccount,
  listPaymentAccounts,
  maskCredential,
} from "@/lib/payment/payment-accounts";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

export async function GET() {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const accounts = await listPaymentAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret.trim() : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey.trim() : undefined;

  if (!label || !accessToken || !webhookSecret) {
    return NextResponse.json(
      { error: "Nome, access token e webhook secret são obrigatórios" },
      { status: 400 },
    );
  }

  const verified = await verify2faBody(session, "PAYMENT_ACCOUNT_CHANGE", "new", body);
  if (!verified.ok) return verified.response;

  const { id } = await createPaymentAccount({ label, accessToken, webhookSecret, publicKey });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAYMENT_ACCOUNT_CREATED",
      entityType: "PaymentAccount",
      entityId: id,
      metadata: {
        label,
        accessToken: maskCredential(accessToken),
        webhookSecret: maskCredential(webhookSecret),
      },
    },
  });

  return NextResponse.json({ id });
}
