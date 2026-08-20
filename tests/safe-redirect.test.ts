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

  it("rejeita bypass de control character (tab/newline/carriage-return antes de //)", () => {
    // WHATWG URL spec: browsers strip ASCII tab/newline/CR before parsing, so "/\t//evil.com"
    // becomes "//evil.com" (protocol-relative) after cleanup
    expect(isSafeRedirectPath("/\t//evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\n//evil.com")).toBe(false);
    expect(isSafeRedirectPath("/\r//evil.com")).toBe(false);
    // Also test the stripped form directly (should still be rejected)
    expect(isSafeRedirectPath("/\t/dashboard")).toBe(false);
    expect(isSafeRedirectPath("/\n/dashboard")).toBe(false);
    expect(isSafeRedirectPath("/\r/dashboard")).toBe(false);
  });
});
