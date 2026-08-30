import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await requestSensitiveActionCode({
    userId: session.user.id,
    actionType: "BACKUP_IMPORT",
    targetId: "backup",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
