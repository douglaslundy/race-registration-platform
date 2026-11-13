export type PaymentMethodType = "PIX" | "CREDIT_CARD" | "BOLETO";

export interface CreatePaymentInput {
  orderId: string;
  amount: number; // centavos
  method: PaymentMethodType;
  idempotencyKey: string;
  buyer: {
    name: string;
    email: string;
    // Dados extras para o antifraude do gateway (additional_info do Mercado Pago) — todos opcionais.
    phone?: string | null;
    registeredAt?: Date;
    address?: { zipCode?: string | null; street?: string | null; number?: string | null };
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
  statusDetail?: string; // motivo da recusa informado pelo gateway (ex: MP `cc_rejected_high_risk`)
}

/** Mensagem ao comprador conforme o motivo da recusa do cartão (status_detail do Mercado Pago). */
export function cardDeclineMessage(statusDetail?: string): string {
  switch (statusDetail) {
    case "cc_rejected_high_risk":
    case "cc_rejected_blacklist":
      return "Pagamento recusado pela análise de segurança do Mercado Pago. Não repita a tentativa com este cartão: pague com PIX ou use outro cartão.";
    case "cc_rejected_insufficient_amount":
      return "Cartão sem limite disponível. Use outro cartão ou pague com PIX.";
    case "cc_rejected_bad_filled_security_code":
      return "Código de segurança (CVV) incorreto. Confira e tente novamente.";
    case "cc_rejected_bad_filled_date":
      return "Data de validade incorreta. Confira e tente novamente.";
    case "cc_rejected_bad_filled_card_number":
    case "cc_rejected_bad_filled_other":
      return "Dados do cartão incorretos. Confira e tente novamente.";
    case "cc_rejected_call_for_authorize":
      return "O banco pede que você autorize esta compra. Ligue para o banco do cartão e tente de novo, ou pague com PIX.";
    case "cc_rejected_card_disabled":
      return "Cartão desabilitado. Ative-o com o banco ou use outro meio de pagamento.";
    case "cc_rejected_duplicated_payment":
      return "Já existe um pagamento igual recente neste cartão. Aguarde alguns minutos ou pague com PIX.";
    case "cc_rejected_max_attempts":
      return "Limite de tentativas atingido neste cartão. Use outro cartão ou pague com PIX.";
    default:
      return "Pagamento recusado pela operadora do cartão. Verifique os dados, tente outro cartão ou pague com PIX.";
  }
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

/** Resumo de um pagamento do gateway, vindo de uma busca por intervalo de atualização. */
export interface GatewayPaymentSummary {
  providerPaymentId: string;
  status: PaymentStatusCheck;
  /** Para o Mercado Pago, o `orderId` que enviamos na criação. */
  externalReference?: string;
  /** `date_last_updated` do gateway (ISO). */
  updatedAt?: string;
}

export interface GatewaySearchResult {
  payments: GatewayPaymentSummary[];
  /** true quando o limite de páginas foi atingido — há mais resultados além de `payments`. */
  truncated: boolean;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  cancelPayment(providerPaymentId: string): Promise<void>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhookSignature(payload: string, signature: string, requestId?: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
  checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
  /**
   * Opcional: lista, em ordem crescente de atualização, os pagamentos do gateway atualizados desde
   * `since`. Permite conciliar por delta (e achar cobranças sem registro local) em vez de consultar
   * pagamento por pagamento.
   */
  searchUpdatedSince?(since: Date): Promise<GatewaySearchResult>;
}

/** Erro cuja mensagem é segura para exibir ao comprador (as demais viram msg genérica no checkout). */
export class UserFacingPaymentError extends Error {}

/** Texto legível de um erro de gateway: o SDK do Mercado Pago lança objetos simples (não `Error`). */
export function describeGatewayError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; cause?: unknown };
    const causes = Array.isArray(e.cause)
      ? e.cause.map((c: { code?: unknown; description?: unknown }) => `${c.code ?? ""} ${c.description ?? ""}`.trim()).filter(Boolean)
      : [];
    const base = typeof e.message === "string" ? e.message : JSON.stringify(err);
    return causes.length ? `${base} (${causes.join("; ")})` : base;
  }
  return String(err);
}

/** Erro 3028 do MP: payment_method_id rejeitado (a cobrança nem chegou a ser processada). */
export function isInvalidPaymentMethodError(err: unknown): boolean {
  const cause = (err as { cause?: unknown } | null)?.cause;
  return Array.isArray(cause) && cause.some((c: { code?: unknown }) => Number(c?.code) === 3028);
}
