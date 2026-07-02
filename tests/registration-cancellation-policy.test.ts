import { describe, expect, it } from "vitest";
import { decideCancellationOutcome } from "@/lib/registrations/cancellation-policy";

describe("decideCancellationOutcome", () => {
  it("cancela imediatamente quando o interruptor global está desligado, mesmo com prazo e aprovação configurados", () => {
    const result = decideCancellationOutcome({
      policyEnabled: false,
      cancellationDeadline: new Date("2020-01-01"),
      cancellationRequiresApproval: true,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("cancela imediatamente quando ligado, sem prazo definido e sem exigir aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: null,
      cancellationRequiresApproval: false,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("bloqueia quando ligado e o prazo já passou", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-01-01T00:00:00Z"),
      cancellationRequiresApproval: false,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });

  it("não bloqueia quando o prazo ainda não chegou", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-02-01T00:00:00Z"),
      cancellationRequiresApproval: false,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("vira solicitação quando ligado e o evento exige aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: null,
      cancellationRequiresApproval: true,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "requires_approval" });
  });

  it("prioriza o bloqueio por prazo sobre a exigência de aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-01-01T00:00:00Z"),
      cancellationRequiresApproval: true,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });

  it("trata o prazo exatamente no limite (now === deadline) como já encerrado", () => {
    const deadline = new Date("2026-01-01T12:00:00Z");
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: deadline,
      cancellationRequiresApproval: false,
      now: new Date(deadline),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });
});
