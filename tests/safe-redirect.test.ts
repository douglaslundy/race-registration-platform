import { describe, expect, it } from "vitest";
import { isSafeRedirectPath } from "@/lib/auth/safe-redirect";

describe("isSafeRedirectPath", () => {
  it("aceita paths relativos simples", () => {
    expect(isSafeRedirectPath("/dashboard")).toBe(true);
    expect(isSafeRedirectPath("/preferencias")).toBe(true);
    expect(isSafeRedirectPath("/inscricao/corrida-abc")).toBe(true);
  });

  it("rejeita ausente/vazio", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejeita protocol-relative (//host)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejeita URL absoluta com outro host", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
    expect(isSafeRedirectPath("http://evil.com/dashboard")).toBe(false);
  });

  it("rejeita esquema javascript:", () => {
    expect(isSafeRedirectPath("javascript:alert(1)")).toBe(false);
  });

  it("rejeita path que não começa com barra", () => {
    expect(isSafeRedirectPath("dashboard")).toBe(false);
  });

  it("rejeita tentativa de host via barra invertida (/\\\\host)", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
  });
});
