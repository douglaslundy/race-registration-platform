export type CancellationDecision =
  | { outcome: "cancel_immediately" }
  | { outcome: "blocked_deadline_passed" }
  | { outcome: "requires_approval" };

export function decideCancellationOutcome(params: {
  policyEnabled: boolean;
  cancellationDeadline: Date | null;
  cancellationRequiresApproval: boolean;
  now: Date;
}): CancellationDecision {
  if (!params.policyEnabled) {
    return { outcome: "cancel_immediately" };
  }

  if (params.cancellationDeadline && params.cancellationDeadline <= params.now) {
    return { outcome: "blocked_deadline_passed" };
  }

  if (params.cancellationRequiresApproval) {
    return { outcome: "requires_approval" };
  }

  return { outcome: "cancel_immediately" };
}
