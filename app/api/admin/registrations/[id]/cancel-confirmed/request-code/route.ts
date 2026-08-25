import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancel-confirmed-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const registration = await db.registration.findFirst({ where: { id }, select: { status: true } });
  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }
  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Somente inscrições confirmadas podem ser canceladas por este caminho" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "REGISTRATION_CANCEL_CONFIRMED", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
