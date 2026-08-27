import { describe, expect, it } from "vitest";
import { computeOrderAmounts, resolveEffectivePixDiscountPercent } from "@/lib/fees";

// Cenário base da spec: subtotal R$100, plataforma 5% (=R$5), serviço 10% (=R$10), desconto PIX 20%.
const base = {
  subtotal: 10000,
  platformFeePercent: 500, // bps -> 5%
  defaultPlatformFee: 0,
  serviceFeePercent: 1000, // bps -> 10%
  serviceFeeMin: 0,
  pixDiscountPercent: 20,
};

describe("computeOrderAmounts", () => {
  it("cartão (não-PIX): sem desconto, taxa de serviço cheia", () => {
    const r = computeOrderAmounts({ ...base, isPix: false });
    expect(r.platformFee).toBe(500);
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.serviceFeeFinal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(0);
    expect(r.pixDiscountPercent).toBe(0);
    expect(r.total).toBe(11500);
  });

  it("PIX: desconto de 20% só sobre a taxa de serviço", () => {
    const r = computeOrderAmounts({ ...base, isPix: true });
    expect(r.platformFee).toBe(500);
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(200);
    expect(r.serviceFeeFinal).toBe(800);
    expect(r.pixDiscountPercent).toBe(20);
    expect(r.total).toBe(11300);
  });

  it("VALIDAÇÃO CRÍTICA: a Taxa da Plataforma é idêntica em cartão e PIX", () => {
    const card = computeOrderAmounts({ ...base, isPix: false });
    const pix = computeOrderAmounts({ ...base, isPix: true });
    // Este teste deve falhar se o desconto PIX tocar a Taxa da Plataforma, direta ou indiretamente.
    expect(pix.platformFee).toBe(card.platformFee);
    expect(pix.platformFee).toBe(500);
  });

  it("piso da taxa de serviço continua sendo piso após o desconto", () => {
    const r = computeOrderAmounts({
      ...base,
      serviceFeeMin: 900, // piso R$9
      isPix: true,
    });
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.serviceFeeFinal).toBe(900); // max(1000 - 200, 900)
    expect(r.pixDiscountAmount).toBe(100); // desconto EFETIVO, não 200
    expect(r.total).toBe(11400); // subtotal 10000 + platformFee 500 + serviceFeeFinal 900
  });

  it("sem taxa de serviço configurada: desconto é zero mesmo via PIX", () => {
    const r = computeOrderAmounts({
      ...base,
      serviceFeePercent: 0,
      serviceFeeMin: 0,
      isPix: true,
    });
    expect(r.serviceFeeOriginal).toBe(0);
    expect(r.serviceFeeFinal).toBe(0);
    expect(r.pixDiscountAmount).toBe(0);
    expect(r.total).toBe(10500);
  });

  it("desconto PIX de 0% não altera nada", () => {
    const r = computeOrderAmounts({ ...base, pixDiscountPercent: 0, isPix: true });
    expect(r.serviceFeeFinal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(0);
  });

  it("piso da Taxa da Plataforma (defaultPlatformFee) é respeitado e não é afetado pelo PIX", () => {
    const r = computeOrderAmounts({ ...base, defaultPlatformFee: 800, isPix: true });
    expect(r.platformFee).toBe(800); // max(500, 800)
  });
});

describe("resolveEffectivePixDiscountPercent", () => {
  it("evento null herda a global", () => {
    expect(resolveEffectivePixDiscountPercent(null, 20)).toBe(20);
  });
  it("evento undefined herda a global", () => {
    expect(resolveEffectivePixDiscountPercent(undefined, 20)).toBe(20);
  });
  it("evento 0 = sem desconto, NUNCA cai pro global", () => {
    expect(resolveEffectivePixDiscountPercent(0, 20)).toBe(0);
  });
  it("evento com valor próprio sobrepõe a global", () => {
    expect(resolveEffectivePixDiscountPercent(30, 20)).toBe(30);
  });
  it("clampa acima de 100 e abaixo de 0", () => {
    expect(resolveEffectivePixDiscountPercent(150, 0)).toBe(100);
    expect(resolveEffectivePixDiscountPercent(-5, 0)).toBe(0);
    expect(resolveEffectivePixDiscountPercent(null, 999)).toBe(100);
  });
});
