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
