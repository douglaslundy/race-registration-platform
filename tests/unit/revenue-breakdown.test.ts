import { describe, expect, it } from "vitest";
import { computeRevenueBreakdown } from "@/lib/revenue-breakdown";

describe("computeRevenueBreakdown", () => {
  it("calcula a cascata completa a partir dos somatórios brutos", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 25000, // R$250,00 — o que o atleta pagou (Payment.amount)
      platformFeeAmount: 1500, // R$15,00 — Order.platformFeeAmount
      serviceFeeAmount: 500, // R$5,00 — Order.paymentFeeAmount
      gatewayFeeAmount: 850, // R$8,50 — Payment.gatewayFeeAmount (comissão real do MP/Pagar.me)
    });

    expect(result).toEqual({
      grossRevenue: 25000,
      platformFeeAmount: 1500,
      serviceFeeAmount: 500,
      eventRevenue: 23000, // 25000 - 1500 - 500 — o que o organizador recebe (== subtotalAmount)
      gatewayFeeAmount: 850,
      platformNetMargin: 1150, // (1500 + 500) - 850 — o que sobra pra plataforma depois do gateway
    });
  });

  it("zera tudo quando não há receita no período", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 0,
      platformFeeAmount: 0,
      serviceFeeAmount: 0,
      gatewayFeeAmount: 0,
    });

    expect(result).toEqual({
      grossRevenue: 0,
      platformFeeAmount: 0,
      serviceFeeAmount: 0,
      eventRevenue: 0,
      gatewayFeeAmount: 0,
      platformNetMargin: 0,
    });
  });

  it("permite margem da plataforma negativa quando a comissão do gateway supera as taxas cobradas (sinaliza prejuízo real)", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 10000,
      platformFeeAmount: 500,
      serviceFeeAmount: 0,
      gatewayFeeAmount: 900,
    });

    expect(result.platformNetMargin).toBe(-400);
  });

  it("trata gatewayFeeAmount ausente (ainda não informado pelo gateway) como zero", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 10000,
      platformFeeAmount: 500,
      serviceFeeAmount: 0,
      gatewayFeeAmount: undefined,
    });

    expect(result.gatewayFeeAmount).toBe(0);
    expect(result.platformNetMargin).toBe(500);
  });
});
