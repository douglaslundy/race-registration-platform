import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import type { PaymentMethod } from "@prisma/client";

const schema = z.object({
  adPlanId: z.string().min(1),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cardToken: z.string().optional(),
  cardBrand: z.string().optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  if (!advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  let checkout;
  try {
    checkout = await createAdPlanCheckout(advertiser.id, parsed.data.adPlanId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar compra";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const provider = await getPaymentProvider();
  const idempotencyKey = `${checkout.adPurchaseId}_${parsed.data.paymentMethod}_${randomUUID()}`;

  const paymentResult = await provider.createPayment({
    orderId: checkout.adPurchaseId,
    amount: checkout.totalAmount,
    method: parsed.data.paymentMethod,
    idempotencyKey,
    buyer: { name: session.user.name, email: session.user.email },
    description: `Compra de plano de anúncio`,
    cardToken: parsed.data.cardToken,
    cardBrand: parsed.data.cardBrand,
    installments: parsed.data.installments,
  });

  const providerKey = await getPaymentProviderSetting();

  await db.payment.create({
    data: {
      adPurchaseId: checkout.adPurchaseId,
      provider: providerKey,
      providerPaymentId: paymentResult.providerPaymentId,
      method: parsed.data.paymentMethod as PaymentMethod,
      status: paymentResult.status,
      amount: checkout.totalAmount,
      pixQrCodeText: paymentResult.pixQrCodeText,
      boletoUrl: paymentResult.boletoUrl,
      expiresAt: paymentResult.expiresAt ? new Date(paymentResult.expiresAt) : null,
      rawPayload: {},
      idempotencyKey,
    },
  });

  return NextResponse.json({
    adPurchaseId: checkout.adPurchaseId,
    status: paymentResult.status,
    pixQrCode: paymentResult.pixQrCode,
    pixQrCodeText: paymentResult.pixQrCodeText,
    boletoUrl: paymentResult.boletoUrl,
    checkoutUrl: paymentResult.checkoutUrl,
  });
}
