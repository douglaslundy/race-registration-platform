import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentAccountById } from "@/lib/payment/account-resolver";
import { refundPayment } from "@/lib/payment/refund-service";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment/account-resolver", () => ({
  getPaymentAccountById: vi.fn(),
  NoPaymentAccountError: class NoPaymentAccountError extends Error {},
}));
vi.mock("@/lib/payment/sync-payment-status", () => ({ applyGatewayStatus: vi.fn() }));

const dbMock = db as any;
const getPaymentProviderMock = vi.mocked(getPaymentProvider);
const getPaymentAccountByIdMock = vi.mocked(getPaymentAccountById);

const ARCHIVED_ACCOUNT = {
  id: "acc_1",
  accessToken: "token-conta-arquivada",
  webhookSecret: "wh",
  publicKey: null,
  label: "Conta antiga (arquivada)",
  archived: true,
};

function providerStub() {
  return {
    checkPaymentStatus: vi.fn().mockResolvedValue({ status: "PAID" }),
    refundPayment: vi.fn().mockResolvedValue({ providerRefundId: "refund-1" }),
  } as any;
}

describe("refundPayment — usa a conta congelada no pagamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      typeof fn === "function" ? fn(dbMock) : Promise.all(fn),
    );
  });

  it("resolve a conta Mercado Pago congelada (mesmo arquivada) e passa pro getPaymentProvider", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      provider: "mercadopago",
      paymentAccountId: "acc_1",
      status: "PAID",
      providerPaymentId: "mp-1",
      orderId: "ord-1",
      amount: 1000,
      order: { id: "ord-1", registrations: [] },
    });
    getPaymentAccountByIdMock.mockResolvedValueOnce(ARCHIVED_ACCOUNT as any);
    const provider = providerStub();
    getPaymentProviderMock.mockResolvedValueOnce(provider);

    await refundPayment({ paymentId: "pay-1", initiatedByUserId: "user-1" });

    expect(getPaymentAccountByIdMock).toHaveBeenCalledWith("acc_1");
    expect(getPaymentProviderMock).toHaveBeenCalledWith(ARCHIVED_ACCOUNT);
  });

  it("pagamento antigo sem paymentAccountId → getPaymentProvider sem conta (fallback global)", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-2",
      provider: "mercadopago",
      paymentAccountId: null,
      status: "PAID",
      providerPaymentId: "mp-2",
      orderId: "ord-2",
      amount: 1000,
      order: { id: "ord-2", registrations: [] },
    });
    const provider = providerStub();
    getPaymentProviderMock.mockResolvedValueOnce(provider);

    await refundPayment({ paymentId: "pay-2", initiatedByUserId: "user-1" });

    expect(getPaymentAccountByIdMock).not.toHaveBeenCalled();
    expect(getPaymentProviderMock).toHaveBeenCalledWith(undefined);
  });

  it("pagamento de outro provedor (pagarme) nunca resolve uma PaymentAccount", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-3",
      provider: "pagarme",
      paymentAccountId: "acc_1",
      status: "PAID",
      providerPaymentId: "ch-3",
      orderId: "ord-3",
      amount: 1000,
      order: { id: "ord-3", registrations: [] },
    });
    const provider = providerStub();
    getPaymentProviderMock.mockResolvedValueOnce(provider);

    await refundPayment({ paymentId: "pay-3", initiatedByUserId: "user-1" });

    expect(getPaymentAccountByIdMock).not.toHaveBeenCalled();
    expect(getPaymentProviderMock).toHaveBeenCalledWith(undefined);
  });
});
