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
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  pixQrCode?: string;
  pixQrCodeText?: string;
  boletoUrl?: string;
  checkoutUrl?: string; // for redirect-based flows (e.g. MP Checkout Pro)
  expiresAt?: Date;
  gatewayFeeAmount?: number; // centavos - preenchido quando o gateway ja aprova e informa a comissao na criacao
}

export interface PaymentWebhookPayload {
  providerPaymentId: string;
  status: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
  paidAt?: string;
  gatewayFeeAmount?: number; // centavos
  rawPayload: Record<string, unknown>;
}

export interface RefundPaymentInput {
  providerPaymentId: string;
}

export interface RefundPaymentResult {
  providerRefundId?: string;
}

export type PaymentStatusCheck = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";

export interface PaymentStatusResult {
  status: PaymentStatusCheck;
  gatewayFeeAmount?: number; // centavos - comissao cobrada pelo gateway, quando disponivel
  paidAt?: string; // data real de aprovacao no gateway, quando disponivel
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  cancelPayment(providerPaymentId: string): Promise<void>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
  checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
}
