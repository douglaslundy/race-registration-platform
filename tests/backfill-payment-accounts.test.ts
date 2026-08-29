import { describe, it, expect, vi, beforeEach } from "vitest";
import { backfillPaymentAccounts } from "@/prisma/backfill-payment-accounts";

function makePrisma(overrides: any = {}) {
  return {
    platformSetting: { findMany: vi.fn().mockResolvedValue([]) },
    paymentAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "acc_1" }),
    },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 42 }) },
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it("com mp_access_token: cria 'Mercado Pago Principal' default e faz backfill dos pagamentos MP", async () => {
  const prisma = makePrisma({
    platformSetting: {
      findMany: vi.fn().mockResolvedValue([
        { key: "mp_access_token", value: "TOKEN" },
        { key: "mp_webhook_secret", value: "SECRET" },
        { key: "mp_public_key", value: "PUB" },
      ]),
    },
  });
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).toHaveBeenCalledWith({
    data: { label: "Mercado Pago Principal", accessToken: "TOKEN", webhookSecret: "SECRET", publicKey: "PUB", isDefault: true },
  });
  expect(prisma.payment.updateMany).toHaveBeenCalledWith({
    where: { provider: "mercadopago", paymentAccountId: null },
    data: { paymentAccountId: "acc_1" },
  });
  expect(res).toEqual({ created: true, backfilled: 42 });
});

it("sem mp_access_token: não cria conta nenhuma", async () => {
  const prisma = makePrisma();
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).not.toHaveBeenCalled();
  expect(res).toEqual({ created: false, backfilled: 0 });
});

it("idempotente: se já existe conta default, não recria", async () => {
  const prisma = makePrisma({
    platformSetting: { findMany: vi.fn().mockResolvedValue([{ key: "mp_access_token", value: "TOKEN" }]) },
    paymentAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc_existing" }), create: vi.fn() },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  });
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).not.toHaveBeenCalled();
  expect(res.created).toBe(false);
});
