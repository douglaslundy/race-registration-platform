import { db } from "./db";
import { calculatePlatformFee } from "./format";
import { getSetting } from "./settings";
import { isBatchAvailable } from "./batch-status";
import type { ShirtSize } from "@prisma/client";

export interface CheckoutInput {
  eventId: string;
  ticketBatchId: string;
  routeId?: string;
  categoryId?: string;
  buyerUserId: string;
  athleteUserId: string;
  shirtSize?: ShirtSize;
  teamName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  medicalNotes?: string;
  couponCode?: string;
}

export interface CheckoutResult {
  orderId: string;
  registrationId: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  platformFeeAmount: number;
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const defaultFeeStr = await getSetting("default_platform_fee");
  const defaultPlatformFee = defaultFeeStr ? parseInt(defaultFeeStr, 10) : 500;
  const serviceFeePercentStr = await getSetting("service_fee_percent");
  const serviceFeePercent = serviceFeePercentStr ? parseInt(serviceFeePercentStr, 10) : 0;
  const serviceFeeMinStr = await getSetting("service_fee_min");
  const serviceFeeMin = serviceFeeMinStr ? parseInt(serviceFeeMinStr, 10) : 0;

  return db.$transaction(async (tx) => {
    const [batch, allBatches] = await Promise.all([
      tx.ticketBatch.findUnique({ where: { id: input.ticketBatchId } }),
      tx.ticketBatch.findMany({ where: { eventId: input.eventId }, orderBy: { startAt: "asc" } }),
    ]);
    if (!batch) throw new Error("Lote não encontrado");
    if (!isBatchAvailable(batch, allBatches)) throw new Error("Lote não disponível");

    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "REGISTRATIONS_OPEN") throw new Error("Inscrições não abertas");

    let discountAmount = 0;
    let couponId: string | undefined;

    const couponCode = input.couponCode?.trim().toUpperCase();

    if (couponCode) {
      const coupon = await tx.coupon.findFirst({
        where: {
          eventId: input.eventId,
          code: couponCode,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      });
      if (!coupon) {
        throw new Error("Cupom inválido");
      }
      if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
        throw new Error("Cupom esgotado");
      }

      couponId = coupon.id;
      if (coupon.discountType === "PERCENT") {
        discountAmount = Math.round((batch.priceAmount * coupon.discountValue) / 100);
      } else {
        discountAmount = Math.min(coupon.discountValue, batch.priceAmount);
      }
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }

    const subtotal = batch.priceAmount - discountAmount;
    const percentFee = calculatePlatformFee(subtotal, event.platformFeePercent);
    const platformFee = Math.max(percentFee, defaultPlatformFee);
    const rawServiceFee = Math.round((subtotal * serviceFeePercent) / 10000);
    const paymentFee = (serviceFeePercent > 0 || serviceFeeMin > 0)
      ? Math.max(rawServiceFee, serviceFeeMin)
      : 0;
    const total = subtotal + platformFee + paymentFee;

    const order = await tx.order.create({
      data: {
        buyerUserId: input.buyerUserId,
        eventId: input.eventId,
        subtotalAmount: subtotal,
        platformFeeAmount: platformFee,
        paymentFeeAmount: paymentFee,
        totalAmount: total,
        discountAmount,
        couponId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const registration = await tx.registration.create({
      data: {
        eventId: input.eventId,
        athleteUserId: input.athleteUserId,
        routeId: input.routeId,
        categoryId: input.categoryId,
        ticketBatchId: input.ticketBatchId,
        orderId: order.id,
        shirtSize: input.shirtSize,
        teamName: input.teamName,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        medicalNotes: input.medicalNotes,
        acceptedTermsAt: new Date(),
      },
    });

    await tx.ticketBatch.update({
      where: { id: input.ticketBatchId },
      data: { soldCount: { increment: 1 } },
    });

    return {
      orderId: order.id,
      registrationId: registration.id,
      subtotalAmount: subtotal,
      totalAmount: total,
      discountAmount,
      platformFeeAmount: platformFee,
    };
  });
}
