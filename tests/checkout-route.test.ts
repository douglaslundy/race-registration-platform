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

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const dbMock = db as any;

describe("checkout api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
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
});
