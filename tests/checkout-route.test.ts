import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { auth } from "@/lib/auth";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";
import { checkLowStockAlert } from "@/lib/alerts/low-stock";

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

import { checkRateLimit } from "@/lib/rate-limit";
import { sendProxyRegistrationInvite } from "@/lib/proxy-athlete";

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const rateLimitMock = vi.mocked(checkRateLimit);
const dbMock = db as any;

describe("checkout api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 4 });
  });

  it("retorna 429 e não cria o checkout quando o limite de tentativas é excedido", async () => {
    rateLimitMock.mockReturnValue({ allowed: false, remaining: 0 });
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
        }),
      }) as any,
    );

    expect(rateLimitMock).toHaveBeenCalledWith("checkout:user-1", expect.objectContaining({ requests: 5, windowMs: 60_000 }));
    expect(res.status).toBe(429);
    expect(vi.mocked(createCheckout)).not.toHaveBeenCalled();
  });

  it("rejects a disabled payment method before creating the checkout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "BOLETO",
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.payment.create).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
    expect(checkLowStockAlert).not.toHaveBeenCalled();
  });

  it("verifica o estoque baixo do lote depois de um checkout bem-sucedido", async () => {
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
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(checkLowStockAlert).toHaveBeenCalledWith("batch-1");
  });

  it("permite checkout para usuário ORGANIZER (auto-inscrição liberada)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
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
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Organizador", email: "org@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.payment.create).toHaveBeenCalled();
  });

  it("rejeita observação com mais de 200 caracteres", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          notes: "a".repeat(201),
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("repassa a observação para createCheckout quando dentro do limite", async () => {
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
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          notes: "Chegarei atrasado",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({ notes: "Chegarei atrasado" }));
  });

  it("cancela o pedido e libera a vaga quando o cartão é recusado na criação", async () => {
    enabledMethodsMock.mockResolvedValue(["CREDIT_CARD"]);
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
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-rejected", status: "CANCELLED" }),
    } as any);

    const paymentRow = { id: "payment-1", status: "PENDING" };
    const txMock = {
      payment: { create: vi.fn().mockResolvedValueOnce(paymentRow), update: vi.fn() },
      order: { update: vi.fn() },
      registration: { update: vi.fn() },
      ticketBatch: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    dbMock.$transaction = vi.fn(async (fn: any) => fn(txMock));

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "CREDIT_CARD",
          cardToken: "tok-1",
          cardBrand: "visa",
        }),
      }) as any,
    );

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/recusado/i);

    expect(txMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "order-1", status: "PENDING", providerPaymentId: "pay-rejected" }),
      }),
    );
    expect(txMock.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    expect(txMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "PAYMENT_CARD_REJECTED" }) }),
    );
  });

  it("dispara o convite de acesso quando createCheckout retorna proxyAthleteInvite com e-mail real", async () => {
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
      proxyAthleteInvite: { userId: "new-athlete-1", name: "Maria Atleta", email: "maria@example.com" },
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Comprador", email: "comprador@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          proxyAthlete: {
            name: "Maria Atleta",
            birthDate: "1995-05-20",
            cpf: "111.444.777-35",
            phone: "35999998888",
            email: "maria@example.com",
          },
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(sendProxyRegistrationInvite).toHaveBeenCalledWith({
      name: "Maria Atleta",
      email: "maria@example.com",
      invitedByName: "Comprador",
    });
  });

  it("não dispara convite quando createCheckout não retorna proxyAthleteInvite", async () => {
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
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({ eventId: "event-1", ticketBatchId: "batch-1", paymentMethod: "PIX" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(sendProxyRegistrationInvite).not.toHaveBeenCalled();
  });

  it("rejeita proxyAthlete com CPF inválido (dígito verificador), sem chamar createCheckout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          proxyAthlete: {
            name: "Maria Atleta",
            birthDate: "1995-05-20",
            cpf: "111.444.777-36",
            phone: "35999998888",
          },
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
