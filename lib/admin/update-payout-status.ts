import { db } from "@/lib/db";

export type UpdatePayoutStatusResult =
  | { ok: true; payout: { id: string; status: string } }
  | { ok: false; status: number; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING", "COMPLETED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export async function updatePayoutStatus(params: {
  payoutId: string;
  newStatus: "PROCESSING" | "COMPLETED" | "FAILED";
  note?: string;
  actingUserId: string;
}): Promise<UpdatePayoutStatusResult> {
  const payout = await db.transferPayout.findUnique({
    where: { id: params.payoutId },
    select: { id: true, status: true },
  });
  if (!payout) return { ok: false, status: 404, error: "Repasse não encontrado" };

  const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];
  if (!allowed.includes(params.newStatus)) {
    return { ok: false, status: 400, error: "Repasse já está em estado final" };
  }

  const isTerminal = params.newStatus === "COMPLETED" || params.newStatus === "FAILED";

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.transferPayout.update({
      where: { id: params.payoutId },
      data: {
        status: params.newStatus,
        ...(params.note !== undefined ? { notes: params.note } : {}),
        ...(isTerminal ? { processedAt: new Date() } : {}),
      },
    });

    if (params.newStatus === "FAILED") {
      await tx.order.updateMany({ where: { payoutId: params.payoutId }, data: { payoutId: null } });
    }

    await tx.auditLog.create({
      data: {
        userId: params.actingUserId,
        action: "PAYOUT_STATUS_UPDATED",
        entityType: "TransferPayout",
        entityId: params.payoutId,
        metadata: { previousStatus: payout.status, newStatus: params.newStatus, note: params.note ?? null },
      },
    });

    return result;
  });

  return { ok: true, payout: { id: updated.id, status: updated.status } };
}
