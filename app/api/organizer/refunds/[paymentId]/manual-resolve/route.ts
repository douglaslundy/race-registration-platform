import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";

const schema = z.object({
  resolutionNote: z.string().trim().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const check = await checkApiPermission("payments.manual-resolve");
  if (!check.allowed) return check.response;
  const { session } = check;

  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId, order: { event: { organizer: { userId: organizerUserId } } } },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
