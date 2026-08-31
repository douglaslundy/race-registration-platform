import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generatePayout } from "@/lib/admin/generate-payout";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // M2: gerar um repasse é ação de movimentação de dinheiro — exige 2FA.
  const verified = await verify2faBody(session, "PAYOUT_STATUS_CHANGE", id, body);
  if (!verified.ok) return verified.response;

  const result = await generatePayout(id, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ payout: result.payout }, { status: 201 });
}
