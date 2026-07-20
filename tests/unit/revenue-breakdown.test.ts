import { describe, expect, it } from "vitest";
import { computeRevenueBreakdown } from "@/lib/revenue-breakdown";

describe("computeRevenueBreakdown", () => {
  it("monta a cascata a partir dos somatórios brutos, sem derivar eventRevenue por subtração", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 25000, // R$250,00 — soma de Payment.amount (só pra reconciliar com o gateway)
      eventRevenue: 23000, // R$230,00 — soma de Order.subtotalAmount (o que o organizador recebe)
      platformFeeAmount: 1500, // R$15,00 — Order.platformFeeAmount
      serviceFeeAmount: 500, // R$5,00 — Order.paymentFeeAmount
      gatewayFeeAmount: 850, // R$8,50 — Payment.gatewayFeeAmount (comissão real do MP/Pagar.me)
    });

    expect(result).toEqual({
      grossRevenue: 25000,
      platformFeeAmount: 1500,
      serviceFeeAmount: 500,
      eventRevenue: 23000,
      gatewayFeeAmount: 850,
      platformNetMargin: 1150, // (1500 + 500) - 850 — o que sobra pra plataforma depois do gateway
    });
  });

  it("não infla eventRevenue quando grossRevenue vem inflado por um pedido com mais de um Payment PAID (anomalia real do sistema)", () => {
    // Cenário: um Order teve 2 linhas de Payment marcadas PAID por engano (webhook duplicado).
    // grossRevenue (soma de Payment.amount) fica o dobro do total do pedido, mas eventRevenue
    // (soma de Order.subtotalAmount, contado 1x por pedido) continua correto — porque agora é um
    // input independente, não derivado de grossRevenue por subtração.
    const result = computeRevenueBreakdown({
      grossRevenue: 20000, // 2x o valor real de um único pedido de R$100
      eventRevenue: 9200, // valor real do subtotal daquele único pedido
      platformFeeAmount: 500,
      serviceFeeAmount: 0,
      gatewayFeeAmount: 300,
    });

    expect(result.eventRevenue).toBe(9200);
  });

  it("zera tudo quando não há receita no período", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 0,
      eventRevenue: 0,
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
      eventRevenue: 9500,
      platformFeeAmount: 500,
      serviceFeeAmount: 0,
      gatewayFeeAmount: 900,
    });

    expect(result.platformNetMargin).toBe(-400);
  });

  it("trata campos ausentes (ainda não informados / null vindo de agregação Prisma) como zero", () => {
    const result = computeRevenueBreakdown({
      grossRevenue: 10000,
      eventRevenue: 9500,
      platformFeeAmount: 500,
      serviceFeeAmount: 0,
      gatewayFeeAmount: undefined,
    });

    expect(result.gatewayFeeAmount).toBe(0);
    expect(result.platformNetMargin).toBe(500);
  });
});
