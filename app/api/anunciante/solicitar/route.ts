import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";
import { getDefaultPaymentAccount, NoPaymentAccountError } from "@/lib/payment/account-resolver";
import type { ResolvedPaymentAccount } from "@/lib/payment/account-resolver";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import { getSetting } from "@/lib/settings";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
import type { PaymentMethod } from "@prisma/client";

const profileSchema = z.object({
  companyName: z.string().min(2).max(150),
  document: z.string().min(11).max(18),
  address: z.string().min(5).max(200),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
  instagram: z.string().max(100).optional().nullable(),
  facebook: z.string().max(100).optional().nullable(),
});

const schema = z.object({
  newAccount: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
  }).optional(),
  profile: profileSchema,
  adPlanId: z.string().min(1),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cardToken: z.string().optional(),
  cardBrand: z.string().optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const enabled = await getSetting("ads_marketplace_enabled");
  if (enabled !== "true") {
    return NextResponse.json({ error: "Cadastro de anunciantes não está disponível no momento" }, { status: 403 });
  }

  const session = await auth();

  // M6: rota cria User + Payment sem autenticação (só gated pela setting). Rate-limit por IP.
  const ipCheck = checkRateLimit(`anunciante-solicitar:ip:${getClientIp(req)}`, RATE_LIMITS.AUTH);
  if (!ipCheck.allowed) {
    return NextResponse.json({ error: "Muitas solicitações. Aguarde um minuto e tente novamente." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!session?.user && !parsed.data.newAccount) {
    return NextResponse.json({ error: "Dados da conta são obrigatórios" }, { status: 400 });
  }

  // Solicitação anônima (nova conta): rate-limit adicional por e-mail + checagem de MX
  // (mesma proteção do /api/auth/register — evita spam de contas e bombardeio de caixa).
  if (!session?.user && parsed.data.newAccount) {
    const emailKey = parsed.data.newAccount.email.toLowerCase();
    const emailCheck = checkRateLimit(`anunciante-solicitar:email:${emailKey}`, RATE_LIMITS.AUTH);
    if (!emailCheck.allowed) {
      return NextResponse.json({ error: "Muitas solicitações para este e-mail. Aguarde um minuto." }, { status: 429 });
    }
    if (!(await hasValidMxRecord(parsed.data.newAccount.email))) {
      return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
    }
  }

  const accountResult = await requestAdvertiserAccount({
    existingUserId: session?.user?.id ?? null,
    newAccount: session?.user ? null : parsed.data.newAccount!,
    profile: parsed.data.profile,
  });

  if (!accountResult.ok) {
    return NextResponse.json({ error: accountResult.error }, { status: accountResult.status });
  }

  let checkout;
  try {
    checkout = await createAdPlanCheckout(accountResult.advertiserId, parsed.data.adPlanId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar solicitação";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const buyerName = session?.user?.name ?? parsed.data.newAccount?.name ?? parsed.data.profile.companyName;
  const buyerEmail = session?.user?.email ?? parsed.data.newAccount?.email ?? parsed.data.profile.contactEmail;

  const providerKey = await getPaymentProviderSetting();
  let account: ResolvedPaymentAccount | undefined;
  if (providerKey === "mercadopago") {
    try {
      account = await getDefaultPaymentAccount();
    } catch (e) {
      if (e instanceof NoPaymentAccountError) {
        return NextResponse.json({ error: "Gateway de pagamento não configurado." }, { status: 503 });
      }
      throw e;
    }
  }

  const provider = await getPaymentProvider(account);
  const idempotencyKey = `${checkout.adPurchaseId}_${parsed.data.paymentMethod}_${randomUUID()}`;

  let paymentResult;
  try {
    paymentResult = await provider.createPayment({
      orderId: checkout.adPurchaseId,
      amount: checkout.totalAmount,
      method: parsed.data.paymentMethod,
      idempotencyKey,
      buyer: { name: buyerName, email: buyerEmail },
      description: `Solicitação de conta de anunciante — plano`,
      cardToken: parsed.data.cardToken,
      cardBrand: parsed.data.cardBrand,
      installments: parsed.data.installments,
    });
  } catch (err) {
    console.error(`[anunciante/solicitar] falha ao criar pagamento (adPurchaseId=${checkout.adPurchaseId}):`, err);
    return NextResponse.json(
      {
        error:
          "Sua conta foi criada, mas houve uma falha ao gerar o pagamento. Faça login com o e-mail e senha que você cadastrou e tente novamente em /anuncie para concluir o pagamento.",
      },
      { status: 500 },
    );
  }

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
      paymentAccountId: account?.id ?? null,
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
