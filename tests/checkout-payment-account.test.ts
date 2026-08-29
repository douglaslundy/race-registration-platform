import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { auth } from "@/lib/auth";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/payment-methods", () => ({
  getEnabledPaymentMethods: vi.fn(),
}));

vi.mock("@/lib/checkout", () => ({
  createCheckout: vi.fn(),
}));

vi.mock("@/lib/payment", () => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("@/lib/alerts/low-stock", () => ({
  checkLowStockAlert: vi.fn(),
}));

vi.mock("@/lib/proxy-athlete", () => ({
  sendProxyRegistrationInvite: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});

// Provider fixado em mercadopago pra exercitar o caminho da resolução de conta.
vi.mock("@/lib/payment-settings", () => ({
  getPaymentProviderSetting: vi.fn().mockResolvedValue("mercadopago"),
  getPagarMeApiKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/payment/account-resolver", () => {
  class NoPaymentAccountError extends Error {
    constructor(msg = "Nenhuma conta Mercado Pago configurada") {
      super(msg);
      this.name = "NoPaymentAccountError";
    }
  }
  return {
    NoPaymentAccountError,
    resolveEventPaymentAccount: vi.fn(),
    getDefaultPaymentAccount: vi.fn(),
    getPaymentAccountById: vi.fn(),
  };
});

import { checkRateLimit } from "@/lib/rate-limit";
import { resolveEventPaymentAccount, NoPaymentAccountError } from "@/lib/payment/account-resolver";

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const rateLimitMock = vi.mocked(checkRateLimit);
const resolveAccountMock = vi.mocked(resolveEventPaymentAccount);
const dbMock = db as any;

const ACCOUNT = {
  id: "acct-42",
  accessToken: "APP-token",
  webhookSecret: "whsec",
  publicKey: "APP-pub",
  label: "Conta principal",
  archived: false,
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/checkout", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

function primeHappyPath() {
  enabledMethodsMock.mockResolvedValue(["PIX"]);
  vi.mocked(createCheckout).mockResolvedValueOnce({
    orderId: "order-1",
    registrationId: "reg-1",
    subtotalAmount: 10000,
    totalAmount: 10000,
    discountAmount: 0,
    platformFeeAmount: 0,
    serviceFeeOriginalAmount: 0,
    paymentFeeAmount: 0,
    pixDiscountAmount: 0,
    pixDiscountPercent: 0,
  } as any);
  dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
  dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
  vi.mocked(getPaymentProvider).mockResolvedValueOnce({
    createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
  } as any);
  dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });
}

describe("checkout — congela a conta de pagamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 4 });
  });

  it("resolve a conta do evento com o eventId do checkout e congela Payment.paymentAccountId", async () => {
    resolveAccountMock.mockResolvedValueOnce(ACCOUNT);
    primeHappyPath();

    const res = await POST(
      makeRequest({ eventId: "event-99", ticketBatchId: "batch-1", paymentMethod: "PIX" }),
    );

    expect(res.status).toBe(200);
    expect(resolveAccountMock).toHaveBeenCalledWith("event-99");
    expect(dbMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentAccountId: "acct-42" }),
      }),
    );
  });

  it("retorna 503 quando nenhuma conta Mercado Pago está configurada", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);
    vi.mocked(createCheckout).mockResolvedValueOnce({
      orderId: "order-1",
      registrationId: "reg-1",
      subtotalAmount: 10000,
      totalAmount: 10000,
      discountAmount: 0,
      platformFeeAmount: 0,
      serviceFeeOriginalAmount: 0,
      paymentFeeAmount: 0,
      pixDiscountAmount: 0,
      pixDiscountPercent: 0,
    } as any);
    resolveAccountMock.mockRejectedValueOnce(new NoPaymentAccountError());

    const res = await POST(
      makeRequest({ eventId: "event-99", ticketBatchId: "batch-1", paymentMethod: "PIX" }),
    );

    expect(res.status).toBe(503);
    expect(dbMock.payment.create).not.toHaveBeenCalled();
  });
});
