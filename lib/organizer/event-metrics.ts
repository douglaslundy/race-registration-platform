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
