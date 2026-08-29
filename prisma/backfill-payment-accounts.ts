import { PrismaClient } from "@prisma/client";

export async function backfillPaymentAccounts(
  prisma: Pick<PrismaClient, "platformSetting" | "paymentAccount" | "payment">,
): Promise<{ created: boolean; backfilled: number }> {
  const existing = await prisma.paymentAccount.findFirst({ where: { isDefault: true } });
  if (existing) return { created: false, backfilled: 0 };

  const settings = await prisma.platformSetting.findMany({
    where: { key: { in: ["mp_access_token", "mp_webhook_secret", "mp_public_key"] } },
  });
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const accessToken = (byKey["mp_access_token"] ?? "").trim();
  if (!accessToken) return { created: false, backfilled: 0 };

  const account = await prisma.paymentAccount.create({
    data: {
      label: "Mercado Pago Principal",
      accessToken,
      webhookSecret: (byKey["mp_webhook_secret"] ?? "").trim(),
      publicKey: (byKey["mp_public_key"] ?? "").trim() || null,
      isDefault: true,
    },
  });
  const { count } = await prisma.payment.updateMany({
    where: { provider: "mercadopago", paymentAccountId: null },
    data: { paymentAccountId: account.id },
  });
  return { created: true, backfilled: count };
}

// Executável direto: `npx tsx prisma/backfill-payment-accounts.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  backfillPaymentAccounts(prisma)
    .then((r) => { console.log("[backfill-payment-accounts]", r); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
