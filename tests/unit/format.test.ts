import { describe, it, expect } from "vitest";
import { formatCurrency, slugify, calculatePlatformFee } from "@/lib/format";

describe("formatCurrency", () => {
  it("formats BRL centavos correctly", () => {
    expect(formatCurrency(10000)).toBe("R$ 100,00");
  });

  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("R$ 0,00");
  });

  it("handles odd cents", () => {
    expect(formatCurrency(9999)).toBe("R$ 99,99");
  });
});

describe("slugify", () => {
  it("converts portuguese text to slug", () => {
    expect(slugify("Corrida das Pedras 2025")).toBe("corrida-das-pedras-2025");
  });

  it("handles accents", () => {
    expect(slugify("São Paulo")).toBe("sao-paulo");
  });

  it("removes leading/trailing hyphens", () => {
    expect(slugify("  test  ")).toBe("test");
  });
});

describe("calculatePlatformFee", () => {
  it("calculates 11% fee (1100 bps) correctly", () => {
    expect(calculatePlatformFee(10000, 1100)).toBe(1100);
  });

  it("rounds correctly", () => {
    expect(calculatePlatformFee(9999, 1100)).toBe(1100);
  });

  it("handles zero", () => {
    expect(calculatePlatformFee(0, 1100)).toBe(0);
  });
});
