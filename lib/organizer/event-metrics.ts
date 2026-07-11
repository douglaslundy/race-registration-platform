export interface RegistrationStatusCount {
  status: string;
  count: number;
}

export interface RegistrationStatusBreakdown {
  paid: number;
  pending: number;
  cancelled: number;
}

export function computeRegistrationStatusBreakdown(
  counts: RegistrationStatusCount[]
): RegistrationStatusBreakdown {
  const breakdown: RegistrationStatusBreakdown = { paid: 0, pending: 0, cancelled: 0 };
  for (const { status, count } of counts) {
    if (status === "CONFIRMED") breakdown.paid = count;
    else if (status === "PENDING_PAYMENT") breakdown.pending = count;
    else if (status === "CANCELLED") breakdown.cancelled = count;
  }
  return breakdown;
}

export interface SlotsInfoInput {
  maxParticipants: number | null;
  activeRegistrationsCount: number;
  batchCapacityTotal: number;
  batchSoldTotal: number;
}

export interface SlotsInfo {
  total: number;
  remaining: number;
}

export function computeSlotsInfo(input: SlotsInfoInput): SlotsInfo {
  if (input.maxParticipants !== null) {
    return {
      total: input.maxParticipants,
      remaining: Math.max(0, input.maxParticipants - input.activeRegistrationsCount),
    };
  }
  return {
    total: input.batchCapacityTotal,
    remaining: Math.max(0, input.batchCapacityTotal - input.batchSoldTotal),
  };
}

export interface DimensionStats {
  count: number;
  revenue: number;
}

export interface RegistrationForBreakdown {
  routeId: string | null;
  categoryId: string | null;
  ticketBatchId: string;
  orderSubtotalAmount: number;
}

function accumulate(map: Map<string, DimensionStats>, key: string, amount: number): void {
  const existing = map.get(key) ?? { count: 0, revenue: 0 };
  map.set(key, { count: existing.count + 1, revenue: existing.revenue + amount });
}

export function computeDimensionBreakdowns(registrations: RegistrationForBreakdown[]): {
  byRoute: Map<string, DimensionStats>;
  byCategory: Map<string, DimensionStats>;
  byTicketBatch: Map<string, DimensionStats>;
} {
  const byRoute = new Map<string, DimensionStats>();
  const byCategory = new Map<string, DimensionStats>();
  const byTicketBatch = new Map<string, DimensionStats>();

  for (const r of registrations) {
    if (r.routeId) accumulate(byRoute, r.routeId, r.orderSubtotalAmount);
    if (r.categoryId) accumulate(byCategory, r.categoryId, r.orderSubtotalAmount);
    accumulate(byTicketBatch, r.ticketBatchId, r.orderSubtotalAmount);
  }

  return { byRoute, byCategory, byTicketBatch };
}

const PAYMENT_METHODS = ["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"] as const;

export interface PaymentMethodStats {
  method: string;
  count: number;
  revenue: number;
}

export function buildPaymentMethodSummary(
  groups: { method: string; count: number; revenue: number }[],
): PaymentMethodStats[] {
  const byMethod = new Map(groups.map((g) => [g.method, g]));
  return PAYMENT_METHODS.map((method) => byMethod.get(method) ?? { method, count: 0, revenue: 0 });
}
