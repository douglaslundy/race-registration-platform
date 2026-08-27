/**
 * Motor de cálculo das taxas do pedido — fonte ÚNICA de verdade.
 * Módulo puro (sem I/O): usado pelo backend (createCheckout) e pelo frontend (CheckoutForm)
 * para que backend, checkout, valor persistido e valor enviado ao gateway sejam sempre iguais.
 *
 * Conceitos, mantidos SEMPRE separados:
 *  - Taxa da Plataforma: platformFee. Fórmula intocada por esta feature.
 *  - Taxa de Serviço: serviceFeeOriginal (antes do desconto) / serviceFeeFinal (cobrada).
 *  - Desconto PIX: incide EXCLUSIVAMENTE sobre serviceFeeOriginal.
 */

export function clampPercent(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.round(n);
}

/**
 * Percentual de desconto PIX efetivo para um evento.
 * - eventValue null/undefined  -> herda a global
 * - eventValue === 0            -> 0 (evento explicitamente sem desconto; nunca cai pro global)
 * - eventValue > 0              -> o valor do evento
 */
export function resolveEffectivePixDiscountPercent(
  eventValue: number | null | undefined,
  globalValue: number,
): number {
  if (eventValue === null || eventValue === undefined) return clampPercent(globalValue);
  return clampPercent(eventValue);
}

export interface OrderAmountsInput {
  /** centavos, já com o desconto de cupom aplicado */
  subtotal: number;
  /** basis points (Event.platformFeePercent) */
  platformFeePercent: number;
  /** centavos — piso global da Taxa da Plataforma */
  defaultPlatformFee: number;
  /** basis points (service_fee_percent) */
  serviceFeePercent: number;
  /** centavos (service_fee_min) — piso da Taxa de Serviço */
  serviceFeeMin: number;
  /** percentual inteiro 0–100, já resolvido (global vs. evento) */
  pixDiscountPercent: number;
  isPix: boolean;
}

export interface OrderAmounts {
  subtotal: number;
  /** Taxa da Plataforma — fórmula ATUAL, independe de isPix */
  platformFee: number;
  /** Taxa de Serviço antes do desconto PIX */
  serviceFeeOriginal: number;
  /** percentual efetivamente aplicado (0 se não-PIX ou sem desconto) */
  pixDiscountPercent: number;
  /** desconto efetivo em centavos = serviceFeeOriginal − serviceFeeFinal */
  pixDiscountAmount: number;
  /** Taxa de Serviço efetivamente cobrada */
  serviceFeeFinal: number;
  /** subtotal + platformFee + serviceFeeFinal */
  total: number;
}

export function computeOrderAmounts(i: OrderAmountsInput): OrderAmounts {
  // Taxa da Plataforma — cópia exata da fórmula atual de lib/checkout.ts + lib/format.ts.
  const platformFee = Math.max(
    Math.round((i.subtotal * i.platformFeePercent) / 10000),
    i.defaultPlatformFee,
  );

  // Taxa de Serviço original — cópia exata da fórmula atual de lib/checkout.ts.
  const serviceFeeConfigured = i.serviceFeePercent > 0 || i.serviceFeeMin > 0;
  const serviceFeeOriginal = serviceFeeConfigured
    ? Math.max(Math.round((i.subtotal * i.serviceFeePercent) / 10000), i.serviceFeeMin)
    : 0;

  const pct = clampPercent(i.pixDiscountPercent);
  const applyDiscount = i.isPix && pct > 0 && serviceFeeOriginal > 0;

  let serviceFeeFinal = serviceFeeOriginal;
  let pixDiscountAmount = 0;
  if (applyDiscount) {
    const rawDiscount = Math.round((serviceFeeOriginal * pct) / 100);
    serviceFeeFinal = Math.max(serviceFeeOriginal - rawDiscount, i.serviceFeeMin);
    pixDiscountAmount = serviceFeeOriginal - serviceFeeFinal;
  }

  return {
    subtotal: i.subtotal,
    platformFee,
    serviceFeeOriginal,
    pixDiscountPercent: applyDiscount ? pct : 0,
    pixDiscountAmount,
    serviceFeeFinal,
    total: i.subtotal + platformFee + serviceFeeFinal,
  };
}
