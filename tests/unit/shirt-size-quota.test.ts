import { describe, expect, it } from "vitest";
import { computeSoldOutShirtSizes } from "@/lib/shirt-size-quota";

describe("computeSoldOutShirtSizes", () => {
  it("retorna vazio quando não há nenhuma quota configurada", () => {
    expect(computeSoldOutShirtSizes([], [{ size: "M", count: 999 }])).toEqual([]);
  });

  it("não marca como esgotado um tamanho abaixo da quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 9 }],
    );
    expect(result).toEqual([]);
  });

  it("marca como esgotado um tamanho que atingiu exatamente a quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 10 }],
    );
    expect(result).toEqual(["M"]);
  });

  it("marca como esgotado um tamanho que passou da quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 15 }],
    );
    expect(result).toEqual(["M"]);
  });

  it("trata quota configurada sem nenhum uso registrado como uso = 0 (não esgotado)", () => {
    const result = computeSoldOutShirtSizes([{ size: "M", quantity: 10 }], []);
    expect(result).toEqual([]);
  });

  it("quota = 0 esgota o tamanho imediatamente, mesmo sem nenhum uso", () => {
    const result = computeSoldOutShirtSizes([{ size: "PP", quantity: 0 }], []);
    expect(result).toEqual(["PP"]);
  });

  it("avalia múltiplos tamanhos de forma independente", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }, { size: "G", quantity: 5 }],
      [{ size: "M", count: 10 }, { size: "G", count: 2 }],
    );
    expect(result).toEqual(["M"]);
  });
});
