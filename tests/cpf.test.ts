import { describe, expect, it } from "vitest";
import { normalizeCpf, isValidCpf } from "@/lib/cpf";

describe("normalizeCpf", () => {
  it("remove pontuação e mantém só os dígitos", () => {
    expect(normalizeCpf("111.444.777-35")).toBe("11144477735");
  });

  it("mantém string já só com dígitos", () => {
    expect(normalizeCpf("11144477735")).toBe("11144477735");
  });
});

describe("isValidCpf", () => {
  it("aceita um CPF válido conhecido, com ou sem máscara", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("rejeita CPF com dígito verificador errado", () => {
    expect(isValidCpf("111.444.777-36")).toBe(false);
  });

  it("rejeita sequências com todos os dígitos iguais", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCpf("123456789")).toBe(false);
    expect(isValidCpf("123456789012")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidCpf("")).toBe(false);
  });
});
