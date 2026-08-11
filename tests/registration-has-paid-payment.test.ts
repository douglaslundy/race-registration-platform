import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("registrationHasPaidPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna true quando existe pagamento pago associado", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });

    const result = await registrationHasPaidPayment({ id: "reg-1" });

    expect(result).toBe(true);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      select: { order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } } },
    });
  });

  it("retorna false quando não há pagamento pago", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [] } });

    const result = await registrationHasPaidPayment({ id: "reg-1" });

    expect(result).toBe(false);
  });

  it("retorna false quando a inscrição não existe", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const result = await registrationHasPaidPayment({ id: "reg-inexistente" });

    expect(result).toBe(false);
  });
});
