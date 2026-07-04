import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/webhooks/payment/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const dbMock = db as any;

function makeProvider(parsed: unknown) {
  return {
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    parseWebhookPayload: vi.fn().mockReturnValue(parsed),
  };
}

describe("payment webhook alert hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("avisa o atleta quando o pagamento é cancelado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "CANCELLED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não avisa quando o pagamento é aprovado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});

describe("payment webhook capacity release", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("libera a vaga do lote quando o pagamento estava PENDING e agora expira", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "EXPIRED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: {
        status: "PENDING",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { soldCount: { decrement: 1 } },
    });
  });

  it("não libera a vaga de novo quando o pagamento já não estava mais PENDING (webhook reentregue)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "EXPIRED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "EXPIRED",
      orderId: "order-1",
      order: {
        status: "CANCELLED",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("devolve a vaga quando um webhook de aprovação atrasado chega depois do pagamento já ter expirado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "EXPIRED",
      orderId: "order-1",
      order: {
        status: "CANCELLED",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { soldCount: { increment: 1 } },
    });
  });

  it("não mexe na vaga quando o pagamento é aprovado normalmente a partir de PENDING", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: {
        status: "PENDING",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });
});

describe("payment webhook refund/chargeback sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("processa um webhook de estorno mesmo com o pagamento já PAID (antes era descartado)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "REFUNDED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "PAID",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-1" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "REFUNDED" } });
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("processa chargeback também a partir de PAID", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "CHARGEBACK", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "PAID",
        registrations: [{ id: "reg-1", ticketBatchId: "batch-1" }],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
  });

  it("não reprocessa quando o pagamento já está REFUNDED (webhook duplicado ou tardio)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "REFUNDED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "REFUNDED",
      orderId: "order-1",
      order: {
        id: "order-1",
        status: "REFUNDED",
        registrations: [],
        buyer: { name: "Atleta", email: "atleta@example.com" },
      },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(dbMock.payment.update).not.toHaveBeenCalled();
  });
});
