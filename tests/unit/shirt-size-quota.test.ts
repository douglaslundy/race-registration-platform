import { describe, expect, it } from "vitest";
import { computeShirtSizeAvailability, formatShirtSizeLabel } from "@/lib/shirt-size-quota";

describe("computeShirtSizeAvailability", () => {
  it("quota = 0 esgota o tamanho imediatamente (remaining = 0), mesmo sem nenhum uso", () => {
    const result = computeShirtSizeAvailability(["PP"], [{ size: "PP", quantity: 0 }], []);
    expect(result).toEqual([{ size: "PP", quantity: 0, usedCount: 0, remaining: 0 }]);
  });

  it("avalia múltiplos tamanhos de forma independente", () => {
    const result = computeShirtSizeAvailability(
      ["M", "G"],
      [{ size: "M", quantity: 10 }, { size: "G", quantity: 5 }],
      [{ size: "M", count: 10 }, { size: "G", count: 2 }],
    );
    expect(result).toEqual([
      { size: "M", quantity: 10, usedCount: 10, remaining: 0 },
      { size: "G", quantity: 5, usedCount: 2, remaining: 3 },
    ]);
  });
  it("tamanho sem quota configurada vem com quantity e remaining nulos (ilimitado)", () => {
    const result = computeShirtSizeAvailability(["M"], [], [{ size: "M", count: 5 }]);
    expect(result).toEqual([{ size: "M", quantity: null, usedCount: 5, remaining: null }]);
  });

  it("calcula o restante como quantity - usedCount", () => {
    const result = computeShirtSizeAvailability(["M"], [{ size: "M", quantity: 10 }], [{ size: "M", count: 7 }]);
    expect(result).toEqual([{ size: "M", quantity: 10, usedCount: 7, remaining: 3 }]);
  });

  it("nunca deixa o restante ficar negativo quando o uso já passou da quota", () => {
    const result = computeShirtSizeAvailability(["M"], [{ size: "M", quantity: 10 }], [{ size: "M", count: 15 }]);
    expect(result).toEqual([{ size: "M", quantity: 10, usedCount: 15, remaining: 0 }]);
  });

  it("tamanho com quota mas sem nenhum uso ainda: restante = quota inteira", () => {
    const result = computeShirtSizeAvailability(["M"], [{ size: "M", quantity: 10 }], []);
    expect(result).toEqual([{ size: "M", quantity: 10, usedCount: 0, remaining: 10 }]);
  });

  it("avalia cada tamanho da lista de tamanhos conhecidos, independente da ordem das quotas", () => {
    const result = computeShirtSizeAvailability(
      ["PP", "M"],
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 4 }, { size: "PP", count: 2 }],
    );
    expect(result).toEqual([
      { size: "PP", quantity: null, usedCount: 2, remaining: null },
      { size: "M", quantity: 10, usedCount: 4, remaining: 6 },
    ]);
  });
});

describe("formatShirtSizeLabel", () => {
  it("retorna só o tamanho quando não há quantidade restante informada", () => {
    expect(formatShirtSizeLabel("M")).toBe("M");
  });

  it("inclui a quantidade restante entre parênteses quando informada", () => {
    expect(formatShirtSizeLabel("M", 3)).toBe("M (restam 3)");
  });
});
