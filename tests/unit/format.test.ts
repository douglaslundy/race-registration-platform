import { describe, it, expect } from "vitest";
import { formatCurrency, slugify, calculateAge } from "@/lib/format";

describe("calculateAge", () => {
  it("calcula idade quando o aniversário já passou no ano de referência", () => {
    expect(calculateAge(new Date("1990-03-15"), new Date("2026-08-20"))).toBe(36);
  });

  it("calcula idade quando o aniversário ainda não chegou no ano de referência (não é só diferença de anos)", () => {
    expect(calculateAge(new Date("1990-12-15"), new Date("2026-08-20"))).toBe(35);
  });

  it("calcula idade no dia exato do aniversário", () => {
    expect(calculateAge(new Date("1990-08-20"), new Date("2026-08-20"))).toBe(36);
  });

  it("calcula idade um dia antes do aniversário (mesmo mês)", () => {
    expect(calculateAge(new Date("1990-08-21"), new Date("2026-08-20"))).toBe(35);
  });
});

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
