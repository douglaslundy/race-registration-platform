export type PaymentMethodType = "PIX" | "CREDIT_CARD" | "BOLETO";

export interface CreatePaymentInput {
  orderId: string;
  amount: number; // centavos
  method: PaymentMethodType;
  idempotencyKey: string;
  buyer: {
    name: string;
    email: string;
  };
  description: string;
  cpf?: string;
  // Transparent credit card fields
  cardToken?: string;
  cardBrand?: string;
  installments?: number;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "EXPIRED";
  pixQrCode?: string;
  pixQrCodeText?: string;
  boletoUrl?: string;
  checkoutUrl?: string; // for redirect-based flows (e.g. MP Checkout Pro)
  expiresAt?: Date;
}

export interface PaymentWebhookPayload {
  providerPaymentId: string;
  status: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
  paidAt?: string;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
}
