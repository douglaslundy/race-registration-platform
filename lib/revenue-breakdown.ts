export interface RevenueBreakdownInput {
  /** Soma de `Payment.amount` — o que o atleta efetivamente pagou. Usado só pra exibir "Receita
   * bruta" e como base da reconciliação com o gateway — nunca pra derivar `eventRevenue`. */
  grossRevenue?: number | null;
  /**
   * Soma de `Order.subtotalAmount` — o valor a que o organizador tem direito, contado uma vez
   * por pedido pago. Deliberadamente um input independente, não derivado de
   * `grossRevenue - taxas`: se um pedido acabar com mais de um `Payment` marcado PAID (webhook
   * duplicado, retry) — uma anomalia real que o cron de reconciliação existe pra detectar —
   * `grossRevenue` infla, mas `eventRevenue` buscado direto de `Order.subtotalAmount` continua
   * correto.
   */
  eventRevenue?: number | null;
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
  /** O valor a que o organizador tem direito (== `Order.subtotalAmount`). */
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
  const eventRevenue = input.eventRevenue ?? 0;
  const platformFeeAmount = input.platformFeeAmount ?? 0;
  const serviceFeeAmount = input.serviceFeeAmount ?? 0;
  const gatewayFeeAmount = input.gatewayFeeAmount ?? 0;

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
