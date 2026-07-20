export interface RevenueBreakdownInput {
  /** Soma de `Payment.amount` — o que o atleta efetivamente pagou. */
  grossRevenue?: number | null;
  /** Soma de `Order.platformFeeAmount`. */
  platformFeeAmount?: number | null;
  /** Soma de `Order.paymentFeeAmount` (taxa de serviço). */
  serviceFeeAmount?: number | null;
  /** Soma de `Payment.gatewayFeeAmount` — comissão real cobrada pelo gateway (Mercado Pago/Pagar.me). */
  gatewayFeeAmount?: number | null;
}

export interface RevenueBreakdown {
  grossRevenue: number;
  platformFeeAmount: number;
  serviceFeeAmount: number;
  /** Bruto menos as taxas da plataforma — o valor a que o organizador tem direito (== `Order.subtotalAmount`). */
  eventRevenue: number;
  gatewayFeeAmount: number;
  /**
   * O que sobra pra plataforma depois do gateway descontar a comissão dele — é este valor,
   * não "taxa da plataforma + taxa de serviço" isoladas, que deve bater com o extrato real da
   * conta do gateway de pagamento. Pode ser negativo se a comissão do gateway superar as
   * taxas cobradas do atleta.
   */
  platformNetMargin: number;
}

export function computeRevenueBreakdown(input: RevenueBreakdownInput): RevenueBreakdown {
  const grossRevenue = input.grossRevenue ?? 0;
  const platformFeeAmount = input.platformFeeAmount ?? 0;
  const serviceFeeAmount = input.serviceFeeAmount ?? 0;
  const gatewayFeeAmount = input.gatewayFeeAmount ?? 0;

  const eventRevenue = grossRevenue - platformFeeAmount - serviceFeeAmount;
  const platformNetMargin = platformFeeAmount + serviceFeeAmount - gatewayFeeAmount;

  return {
    grossRevenue,
    platformFeeAmount,
    serviceFeeAmount,
    eventRevenue,
    gatewayFeeAmount,
    platformNetMargin,
  };
}
