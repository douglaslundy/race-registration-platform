import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));
vi.mock("@/lib/payment/sync-payment-status", () => ({ applyGatewayStatus: vi.fn() }));

import { POST } from "@/app/api/webhooks/payment/route";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";

const dbMock = db as any;

function makeProvider(parsed: unknown, checkPaymentStatus?: ReturnType<typeof vi.fn>) {
  return {
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    parseWebhookPayload: vi.fn().mockReturnValue(parsed),
    checkPaymentStatus: checkPaymentStatus ?? vi.fn(),
  };
}

function makePayment() {
  return {
    id: "payment-1",
    status: "PENDING",
    orderId: "order-1",
    order: {
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }],
      buyer: { name: "Atleta", email: "atleta@example.com" },
    },
  };
}

describe("payment webhook — Pagar.me reconfirma status real antes de aplicar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
    vi.mocked(applyGatewayStatus).mockResolvedValue({ changed: true } as any);
  });

  it("ignora um webhook 'charge.paid' quando a consulta real à API diz que o pagamento ainda está PENDING", async () => {
    const checkPaymentStatus = vi.fn().mockResolvedValue({ status: "PENDING" });
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }, checkPaymentStatus) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce(makePayment());

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.paid", data: { id: "pay-1", status: "paid" } }),
      }) as any,
    );

    expect(checkPaymentStatus).toHaveBeenCalledWith("pay-1");
    expect(applyGatewayStatus).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("aplica o status REAL confirmado via API, não o que veio cru no corpo do webhook", async () => {
    const checkPaymentStatus = vi.fn().mockResolvedValue({ status: "CANCELLED" });
    vi.mocked(getPaymentProvider).mockResolvedValue(
      // Payload diz "paid", mas a consulta real diz "CANCELLED" — deve prevalecer o real.
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }, checkPaymentStatus) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce(makePayment());

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.paid", data: { id: "pay-1", status: "paid" } }),
      }) as any,
    );

    expect(applyGatewayStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "CANCELLED",
      "webhook",
      expect.anything(),
    );
  });

  it("confia no status do payload quando a reconsulta à API falha (mesma resiliência do fluxo do Mercado Pago)", async () => {
    const checkPaymentStatus = vi.fn().mockRejectedValue(new Error("Pagar.me indisponível"));
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }, checkPaymentStatus) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce(makePayment());

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.paid", data: { id: "pay-1", status: "paid" } }),
      }) as any,
    );

    expect(applyGatewayStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "PAID",
      "webhook",
      expect.anything(),
    );
  });

  it("não chama checkPaymentStatus para webhooks do Mercado Pago (só o fluxo já existente de fetchMPPaymentStatus se aplica)", async () => {
    const checkPaymentStatus = vi.fn();
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "CANCELLED", rawPayload: {} }, checkPaymentStatus) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce(makePayment());

    // action !== "payment.updated"/"payment.created" e sem "." no valor -> não é detectado como Pagar.me
    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ action: "outro", data: { id: "pay-1" } }),
      }) as any,
    );

    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });
});
