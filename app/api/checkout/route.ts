import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting, getMercadoPagoAccessToken, getPagarMeApiKey } from "@/lib/payment-settings";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import type { ShirtSize, PaymentMethod } from "@prisma/client";
import { emptyStringToUndefined, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { checkLowStockAlert } from "@/lib/alerts/low-stock";

const checkoutSchema = z.object({
  eventId: opaqueIdField(),
  ticketBatchId: opaqueIdField(),
  routeId: optionalOpaqueIdField(),
  categoryId: optionalOpaqueIdField(),
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(20).optional(),
  medicalNotes: z.string().max(500).optional(),
  couponCode: z.string().max(50).optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cpf: z.string().max(14).optional(),
  cardToken: z.string().max(200).optional(),
  cardBrand: z.string().max(50).optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { paymentMethod, cpf, cardToken, cardBrand, installments, ...checkoutData } = parsed.data;
  const enabledPaymentMethods = await getEnabledPaymentMethods();
  if (!enabledPaymentMethods.includes(paymentMethod)) {
    return NextResponse.json({ error: "Meio de pagamento indisponível" }, { status: 400 });
  }

  let checkout;
  try {
    checkout = await createCheckout({
      ...checkoutData,
      routeId: emptyStringToUndefined(checkoutData.routeId) as string | undefined,
      categoryId: emptyStringToUndefined(checkoutData.categoryId) as string | undefined,
      shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
      buyerUserId: session.user.id,
      athleteUserId: session.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar inscrição";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Verifica se o lote está quase esgotado e avisa o organizador (fire-and-forget)
  void checkLowStockAlert(checkoutData.ticketBatchId);

  const idempotencyKey = `${checkout.orderId}_${paymentMethod}_${Date.now()}`;

  const providerKey = await getPaymentProviderSetting();
  if (providerKey === "mercadopago") {
    const token = await getMercadoPagoAccessToken();
    if (!token) {
      return NextResponse.json(
        { error: "Gateway de pagamento não configurado. Acesse Admin → Configurações para configurar o Mercado Pago." },
        { status: 503 }
      );
    }
  }
  if (providerKey === "pagarme") {
    const apiKey = await getPagarMeApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gateway de pagamento não configurado. Acesse Admin → Configurações para configurar o Pagar.me." },
        { status: 503 }
      );
    }
  }

  const provider = await getPaymentProvider();
  const [buyer, athleteProfile] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
    db.athleteProfile.findUnique({
      where: { userId: session.user.id },
      select: { cpf: true },
    }),
  ]);

  const effectiveCpf = cpf ?? athleteProfile?.cpf ?? undefined;

  let paymentResult: Awaited<ReturnType<typeof provider.createPayment>>;
  try {
    paymentResult = await provider.createPayment({
      orderId: checkout.orderId,
      amount: checkout.totalAmount,
      method: paymentMethod,
      idempotencyKey,
      buyer: { name: buyer!.name, email: buyer!.email },
      description: `Inscrição #${checkout.registrationId}`,
      cpf: effectiveCpf,
      cardToken,
      cardBrand,
      installments,
    });
  } catch (payErr) {
    let msg = "Erro no gateway de pagamento";
    if (payErr instanceof Error) {
      msg = payErr.message;
    } else if (payErr && typeof payErr === "object") {
      const obj = payErr as Record<string, unknown>;
      if (typeof obj.message === "string" && obj.message) {
        msg = obj.message;
      } else if (typeof obj.error === "string" && obj.error) {
        msg = obj.error;
      } else {
        try { msg = JSON.stringify(obj).slice(0, 300); } catch { /* keep default */ }
      }
    }
    console.error("[checkout] payment gateway error:", payErr);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const payment = await db.payment.create({
    data: {
      orderId: checkout.orderId,
      provider: providerKey,
      providerPaymentId: paymentResult.providerPaymentId,
      method: paymentMethod as PaymentMethod,
      status: paymentResult.status === "PAID" ? "PAID" : "PENDING",
      amount: checkout.totalAmount,
      idempotencyKey,
      paidAt: paymentResult.status === "PAID" ? new Date() : null,
      gatewayFeeAmount: paymentResult.gatewayFeeAmount ?? null,
      pixQrCodeText: paymentResult.pixQrCodeText ?? null,
      boletoUrl: paymentResult.boletoUrl ?? null,
      expiresAt: paymentResult.expiresAt ? new Date(paymentResult.expiresAt) : null,
    },
  });

  if (paymentResult.status === "PAID") {
    await db.order.update({ where: { id: checkout.orderId }, data: { status: "PAID" } });
    await db.registration.update({
      where: { id: checkout.registrationId },
      data: { status: "CONFIRMED" },
    });
    // Envia a confirmação de inscrição por e-mail (fire-and-forget)
    void notifyOrderConfirmed(checkout.orderId);
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CHECKOUT_INITIATED",
      entityType: "Order",
      entityId: checkout.orderId,
      metadata: { paymentMethod, totalAmount: checkout.totalAmount },
    },
  });

  return NextResponse.json({
    orderId: checkout.orderId,
    registrationId: checkout.registrationId,
    paymentId: payment.id,
    totalAmount: checkout.totalAmount,
    subtotalAmount: checkout.subtotalAmount,
    discountAmount: checkout.discountAmount,
    status: paymentResult.status,
    pixQrCodeText: paymentResult.pixQrCodeText,
    boletoUrl: paymentResult.boletoUrl,
    checkoutUrl: paymentResult.checkoutUrl,
    expiresAt: paymentResult.expiresAt,
  });
}
