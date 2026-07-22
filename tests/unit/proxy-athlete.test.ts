import { describe, expect, it } from "vitest";
import { generatePlaceholderEmail, isPlaceholderEmail } from "@/lib/proxy-athlete";

describe("generatePlaceholderEmail", () => {
  it("gera um e-mail sintético terminando no domínio interno reservado", () => {
    const email = generatePlaceholderEmail();
    expect(email).toMatch(/^[0-9a-f-]{36}@sememail\.internal$/);
  });

  it("gera um valor diferente a cada chamada", () => {
    expect(generatePlaceholderEmail()).not.toBe(generatePlaceholderEmail());
  });
});

describe("isPlaceholderEmail", () => {
  it("retorna true para um e-mail sintético gerado pela própria função", () => {
    expect(isPlaceholderEmail(generatePlaceholderEmail())).toBe(true);
  });

  it("retorna false para um e-mail real", () => {
    expect(isPlaceholderEmail("atleta@example.com")).toBe(false);
  });
});
