import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { attemptAutoRefund } from "@/lib/payment/auto-refund";

export type CancellationDecisionResult =
  | { ok: true; refund?: "processed" | "already_synced" | "failed" | "not_applicable" }
  | { ok: false; status: number; error: string };

export async function decideRegistrationCancellation(params: {
  where: Prisma.RegistrationWhereInput;
  decision: "APPROVE" | "REJECT";
  actingUserId: string;
}): Promise<CancellationDecisionResult> {
  const registration = await db.registration.findFirst({
    where: params.where,
    select: {
      id: true,
      status: true,
      ticketBatchId: true,
      orderId: true,
      cancellationReason: true,
      order: {
        select: {
          payments: {
            where: { status: "PAID" },
            orderBy: { paidAt: "desc" },
            take: 1,
            select: { id: true, amount: true },
          },
        },
      },
    },
  });

  if (!registration) {
    return { ok: false, status: 404, error: "Inscrição não encontrada" };
  }

  if (registration.status !== "CANCELLATION_REQUESTED") {
    return { ok: false, status: 400, error: "Esta inscrição não possui uma solicitação de cancelamento pendente" };
  }

  if (params.decision === "REJECT") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({ where: { id: registration.id }, data: { status: "CONFIRMED" } });
      await tx.auditLog.create({
        data: {
          userId: params.actingUserId,
          action: "REGISTRATION_CANCELLATION_REJECTED",
          entityType: "Registration",
          entityId: registration.id,
        },
      });
    });
    return { ok: true };
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({ where: { id: registration.id }, data: { status: "CANCELLED" } });
    await tx.order.update({ where: { id: registration.orderId }, data: { status: "CANCELLED" } });
    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actingUserId,
        action: "REGISTRATION_CANCELLATION_APPROVED",
        entityType: "Registration",
        entityId: registration.id,
      },
    });
  });

  const paidPayment = registration.order.payments[0];
  if (!paidPayment) return { ok: true, refund: "not_applicable" };

  const result = await attemptAutoRefund({
    payment: paidPayment,
    initiatedByUserId: params.actingUserId,
    reason: registration.cancellationReason ?? undefined,
  });

  return { ok: true, refund: result.outcome };
}

export async function registrationHasPaidPayment(where: Prisma.RegistrationWhereInput): Promise<boolean> {
  const registration = await db.registration.findFirst({
    where,
    select: { order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } } },
  });
  return Boolean(registration?.order.payments.length);
}
