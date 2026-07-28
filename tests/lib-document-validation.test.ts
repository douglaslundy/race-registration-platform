import { describe, expect, it } from "vitest";
import { isValidDocument } from "@/lib/document-validation";

describe("isValidDocument", () => {
  it("aceita CPF válido (com ou sem formatação)", () => {
    expect(isValidDocument("111.444.777-35")).toBe(true);
    expect(isValidDocument("11144477735")).toBe(true);
  });

  it("rejeita CPF inválido", () => {
    expect(isValidDocument("111.111.111-11")).toBe(false);
    expect(isValidDocument("123.456.789-00")).toBe(false);
  });

  it("aceita CNPJ válido (com ou sem formatação)", () => {
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("11222333000181")).toBe(true);
  });

  it("rejeita CNPJ inválido", () => {
    expect(isValidDocument("11.111.111/1111-11")).toBe(false);
  });

  it("rejeita string vazia ou com tamanho errado", () => {
    expect(isValidDocument("")).toBe(false);
    expect(isValidDocument("123")).toBe(false);
    expect(isValidDocument("123456789012345")).toBe(false);
  });
});
