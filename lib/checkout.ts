import { db } from "./db";
import { computeOrderAmounts, resolveEffectivePixDiscountPercent } from "./fees";
import { getSetting } from "./settings";
import { isBatchAvailable } from "./batch-status";
import { normalizeCpf } from "./cpf";
import { generatePlaceholderEmail } from "./proxy-athlete";
import { getAllowedShirtSizes } from "./shirt-size-restriction";
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
  notes?: string;
  couponCode?: string;
  isPix?: boolean;
  proxyAthlete?: {
    name: string;
    birthDate: string;
    cpf: string;
    phone: string;
    email?: string;
  };
}

export interface CheckoutResult {
  orderId: string;
  registrationId: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  platformFeeAmount: number;
  serviceFeeOriginalAmount: number;
  paymentFeeAmount: number;
  pixDiscountAmount: number;
  pixDiscountPercent: number;
  proxyAthleteInvite?: { userId: string; name: string; email: string };
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const defaultFeeStr = await getSetting("default_platform_fee");
  const defaultPlatformFee = defaultFeeStr ? parseInt(defaultFeeStr, 10) : 500;
  const serviceFeePercentStr = await getSetting("service_fee_percent");
  const serviceFeePercent = serviceFeePercentStr ? parseInt(serviceFeePercentStr, 10) : 0;
  const serviceFeeMinStr = await getSetting("service_fee_min");
  const serviceFeeMin = serviceFeeMinStr ? parseInt(serviceFeeMinStr, 10) : 0;
  const pixDiscountStr = await getSetting("pix_service_fee_discount_percent");
  const globalPixDiscount = pixDiscountStr ? parseInt(pixDiscountStr, 10) : 0;

  return db.$transaction(async (tx) => {
    const [batch, allBatches] = await Promise.all([
      tx.ticketBatch.findUnique({ where: { id: input.ticketBatchId } }),
      tx.ticketBatch.findMany({ where: { eventId: input.eventId }, orderBy: { startAt: "asc" } }),
    ]);
    if (!batch) throw new Error("Lote não encontrado");
    if (!isBatchAvailable(batch, allBatches)) throw new Error("Lote não disponível");

    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "REGISTRATIONS_OPEN") throw new Error("Inscrições não abertas");

    if (input.shirtSize) {
      const allowedSizes = getAllowedShirtSizes(event, new Date());
      if (!allowedSizes.includes(input.shirtSize)) {
        throw new Error("Tamanho de camiseta indisponível para este evento");
      }
    }

    if (input.proxyAthlete && !event.allowProxyRegistration) {
      throw new Error("Inscrição por procuração não está habilitada para este evento");
    }

    // Percurso e categoria são obrigatórios quando o evento os oferece.
    const [routeCount, categoryCount] = await Promise.all([
      tx.eventRoute.count({ where: { eventId: input.eventId } }),
      tx.eventCategory.count({ where: { eventId: input.eventId } }),
    ]);

    if (routeCount > 0) {
      if (!input.routeId) throw new Error("Selecione um percurso para concluir a inscrição");
      const route = await tx.eventRoute.findFirst({
        where: { id: input.routeId, eventId: input.eventId },
        select: { id: true },
      });
      if (!route) throw new Error("Percurso inválido para este evento");
    }

    if (categoryCount > 0) {
      if (!input.categoryId) throw new Error("Selecione uma categoria para concluir a inscrição");
      const category = await tx.eventCategory.findFirst({
        where: { id: input.categoryId, eventId: input.eventId },
        select: { id: true },
      });
      if (!category) throw new Error("Categoria inválida para este evento");
    }

    let athleteUserId = input.athleteUserId;
    let proxyAthleteInvite: CheckoutResult["proxyAthleteInvite"];

    if (input.proxyAthlete) {
      const proxyCpf = normalizeCpf(input.proxyAthlete.cpf);
      // Busca só pelo CPF — se já existe conta (Fase B), reaproveita e nunca cria duplicata; se
      // coincidir com o próprio comprador, o resultado já é idêntico a uma inscrição normal.
      const existingProfile = await tx.athleteProfile.findFirst({ where: { cpf: proxyCpf } });

      if (existingProfile) {
        athleteUserId = existingProfile.userId;
      } else {
        const realEmail = input.proxyAthlete.email?.trim();
        const proxyEmail = realEmail || generatePlaceholderEmail();
        if (realEmail) {
          const emailTaken = await tx.user.findUnique({ where: { email: proxyEmail }, select: { id: true } });
          if (emailTaken) throw new Error("Este e-mail já está em uso por outra conta");
        }

        const newAthlete = await tx.user.create({
          data: {
            name: input.proxyAthlete.name,
            email: proxyEmail,
            role: "ATHLETE",
            passwordHash: null,
            athleteProfile: {
              create: {
                cpf: proxyCpf,
                birthDate: new Date(input.proxyAthlete.birthDate),
                phone: input.proxyAthlete.phone,
              },
            },
          },
        });
        athleteUserId = newAthlete.id;
        if (realEmail) {
          proxyAthleteInvite = { userId: newAthlete.id, name: newAthlete.name, email: realEmail };
        }
      }
    }

    let discountAmount = 0;
    let couponId: string | undefined;

    const couponCode = input.couponCode?.trim().toUpperCase();

    if (couponCode) {
      // Busca só pelo código (sem filtrar validade/status na query) — cada condição é checada
      // depois, separadamente, pra poder informar o motivo exato de rejeição (vencido vs.
      // esgotado vs. inexistente/inativo), em vez de colapsar tudo em "Cupom inválido".
      // Cupom específico do evento tem prioridade sobre o cupom global.
      const coupon =
        (await tx.coupon.findFirst({ where: { eventId: input.eventId, code: couponCode } })) ??
        (await tx.coupon.findFirst({ where: { eventId: null, code: couponCode } }));
      if (!coupon || !coupon.active) {
        throw new Error("Cupom inválido");
      }
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        throw new Error("Cupom vencido");
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
    const effectivePixDiscount = resolveEffectivePixDiscountPercent(
      event.pixServiceFeeDiscountPercent,
      globalPixDiscount,
    );
    const amounts = computeOrderAmounts({
      subtotal,
      platformFeePercent: event.platformFeePercent,
      defaultPlatformFee,
      serviceFeePercent,
      serviceFeeMin,
      pixDiscountPercent: effectivePixDiscount,
      isPix: input.isPix ?? false,
    });

    const order = await tx.order.create({
      data: {
        buyerUserId: input.buyerUserId,
        eventId: input.eventId,
        subtotalAmount: subtotal,
        platformFeeAmount: amounts.platformFee,
        paymentFeeAmount: amounts.serviceFeeFinal,
        serviceFeeOriginalAmount: amounts.serviceFeeOriginal,
        pixDiscountPercent: amounts.pixDiscountPercent,
        pixDiscountAmount: amounts.pixDiscountAmount,
        totalAmount: amounts.total,
        discountAmount,
        couponId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const registration = await tx.registration.create({
      data: {
        eventId: input.eventId,
        athleteUserId,
        routeId: input.routeId,
        categoryId: input.categoryId,
        ticketBatchId: input.ticketBatchId,
        orderId: order.id,
        shirtSize: input.shirtSize,
        teamName: input.teamName,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        medicalNotes: input.medicalNotes,
        notes: input.notes,
        proxyAthleteDisplayName: input.proxyAthlete?.name,
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
      totalAmount: amounts.total,
      discountAmount,
      platformFeeAmount: amounts.platformFee,
      serviceFeeOriginalAmount: amounts.serviceFeeOriginal,
      paymentFeeAmount: amounts.serviceFeeFinal,
      pixDiscountAmount: amounts.pixDiscountAmount,
      pixDiscountPercent: amounts.pixDiscountPercent,
      proxyAthleteInvite,
    };
  });
}
