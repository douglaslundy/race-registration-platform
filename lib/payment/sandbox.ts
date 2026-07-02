import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";

export class SandboxPaymentProvider implements PaymentProvider {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const id = `sandbox_${input.idempotencyKey}`;
    if (input.method === "PIX") {
      return { providerPaymentId: id, status: "PENDING", pixQrCodeText: `SANDBOX_PIX_${id}`, expiresAt: new Date(Date.now() + 30 * 60 * 1000) };
    }
    if (input.method === "BOLETO") {
      return { providerPaymentId: id, status: "PENDING", boletoUrl: `https://sandbox.example/boleto/${id}`, expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000) };
    }
    return { providerPaymentId: id, status: "PAID" };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    return { providerRefundId: `sandbox_refund_${input.providerPaymentId}` };
  }

  async verifyWebhookSignature(_payload: string, signature: string): Promise<boolean> {
    return signature === (process.env.PAYMENT_WEBHOOK_SECRET ?? "sandbox-secret");
  }

  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload {
    return {
      providerPaymentId: String(payload.id),
      status: String(payload.status) as PaymentWebhookPayload["status"],
      paidAt: payload.paid_at ? String(payload.paid_at) : undefined,
      rawPayload: payload,
    };
  }
}
