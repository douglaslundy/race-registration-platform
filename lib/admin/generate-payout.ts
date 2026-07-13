import { db } from "@/lib/db";

export interface PayoutPreview {
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

export async function computeEligiblePayoutTotals(eventId: string): Promise<PayoutPreview> {
  const agg = await db.order.aggregate({
    where: { eventId, status: "PAID", payoutId: null },
    _count: { id: true },
    _sum: { totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  const grossAmount = agg._sum.totalAmount ?? 0;
  const platformFee = (agg._sum.platformFeeAmount ?? 0) + (agg._sum.paymentFeeAmount ?? 0);
  return { orderCount: agg._count.id, grossAmount, platformFee, netAmount: grossAmount - platformFee };
}

export type GeneratePayoutResult =
  | { ok: true; payout: { id: string; grossAmount: number; platformFee: number; netAmount: number } }
  | { ok: false; status: number; error: string };

export async function generatePayout(eventId: string, actingUserId: string): Promise<GeneratePayoutResult> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
  if (!event) return { ok: false, status: 404, error: "Evento não encontrado" };

  const orders = await db.order.findMany({
    where: { eventId, status: "PAID", payoutId: null },
    select: { id: true, totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  if (orders.length === 0) {
    return { ok: false, status: 400, error: "Nenhum pedido pago pendente de repasse para este evento." };
  }

  const grossAmount = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const platformFee = orders.reduce((sum, o) => sum + o.platformFeeAmount + o.paymentFeeAmount, 0);
  const netAmount = grossAmount - platformFee;

  try {
    const payout = await db.$transaction(async (tx) => {
      const created = await tx.transferPayout.create({
        data: { eventId, organizerId: event.organizerId, grossAmount, platformFee, netAmount },
      });
      const claimed = await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, payoutId: null },
        data: { payoutId: created.id },
      });
      if (claimed.count !== orders.length) {
        throw new Error("PAYOUT_CONCURRENT_CLAIM");
      }
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: "PAYOUT_GENERATED",
          entityType: "TransferPayout",
          entityId: created.id,
          metadata: { eventId, orderCount: orders.length, grossAmount, netAmount },
        },
      });
      return created;
    });

    return {
      ok: true,
      payout: { id: payout.id, grossAmount: payout.grossAmount, platformFee: payout.platformFee, netAmount: payout.netAmount },
    };
  } catch (err) {
    if (err instanceof Error && err.message === "PAYOUT_CONCURRENT_CLAIM") {
      return {
        ok: false,
        status: 409,
        error: "Alguns pedidos já foram incluídos em outro repasse enquanto este era gerado. Tente novamente.",
      };
    }
    throw err;
  }
}
