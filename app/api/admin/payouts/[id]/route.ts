import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updatePayoutStatus } from "@/lib/admin/update-payout-status";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

const schema = z.object({
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // M2: transição de status de repasse é ação de movimentação de dinheiro — exige 2FA.
  const verified = await verify2faBody(session, "PAYOUT_STATUS_CHANGE", id, body);
  if (!verified.ok) return verified.response;

  const result = await updatePayoutStatus({
    payoutId: id,
    newStatus: parsed.data.status,
    note: parsed.data.note,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ payout: result.payout });
}
