import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { attemptAutoRefund } from "@/lib/payment/auto-refund";
import { notifyRegistrationCancelledByStaff } from "@/lib/alerts/registration-cancelled-by-staff";

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

/**
 * Cancelamento DIRETO de uma inscrição CONFIRMED por admin/organizador — diferente de
 * decideRegistrationCancellation (que só decide sobre um pedido já em CANCELLATION_REQUESTED
 * feito pelo próprio atleta), esta função age direto sobre uma inscrição confirmada, sem exigir
 * um pedido prévio. Cancela a inscrição/pedido, libera a vaga do lote, tenta o estorno automático
 * (ou marca REFUND_PENDING pro estorno manual, via attemptAutoRefund) e avisa o atleta (e-mail +
 * WhatsApp) com o motivo informado. Não grava o audit log — cada rota chamadora grava com a ação
 * certa (REGISTRATION_CANCELLED_BY_ORGANIZER/_BY_ADMIN), mesmo padrão já usado por
 * cancelPendingPaymentManually.
 */
export async function cancelConfirmedRegistrationDirectly(params: {
  where: Prisma.RegistrationWhereInput;
  reason: string;
  actingUserId: string;
}): Promise<CancellationDecisionResult> {
  const registration = await db.registration.findFirst({
    where: params.where,
    select: {
      id: true,
      status: true,
      ticketBatchId: true,
      orderId: true,
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

  if (registration.status !== "CONFIRMED") {
    return { ok: false, status: 400, error: "Somente inscrições confirmadas podem ser canceladas por este caminho" };
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id: registration.id },
      data: { status: "CANCELLED", cancellationReason: params.reason },
    });
    await tx.order.update({ where: { id: registration.orderId }, data: { status: "CANCELLED" } });
    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });
  });

  void notifyRegistrationCancelledByStaff(registration.id);

  const paidPayment = registration.order.payments[0];
  if (!paidPayment) return { ok: true, refund: "not_applicable" };

  const result = await attemptAutoRefund({
    payment: paidPayment,
    initiatedByUserId: params.actingUserId,
    reason: params.reason,
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
