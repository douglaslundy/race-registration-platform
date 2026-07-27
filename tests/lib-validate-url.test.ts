import { describe, expect, it } from "vitest";
import { validateAdDestinationUrl } from "@/lib/validate-url";

describe("validateAdDestinationUrl", () => {
  it("aceita URL https absoluta", () => {
    expect(validateAdDestinationUrl("https://empresa.com/pagina")).toEqual({
      ok: true,
      url: "https://empresa.com/pagina",
    });
  });

  it("rejeita http (exige https)", () => {
    const result = validateAdDestinationUrl("http://empresa.com");
    expect(result.ok).toBe(false);
  });

  it("rejeita javascript:", () => {
    const result = validateAdDestinationUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("rejeita data:", () => {
    expect(validateAdDestinationUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("rejeita file:", () => {
    expect(validateAdDestinationUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejeita ftp:", () => {
    expect(validateAdDestinationUrl("ftp://empresa.com").ok).toBe(false);
  });

  it("rejeita URL malformada", () => {
    expect(validateAdDestinationUrl("não é uma url").ok).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(validateAdDestinationUrl("").ok).toBe(false);
  });

  it("remove espaços nas pontas antes de validar", () => {
    expect(validateAdDestinationUrl("  https://empresa.com  ")).toEqual({
      ok: true,
      url: "https://empresa.com/",
    });
  });

  it("rejeita URL maior que 500 caracteres", () => {
    const long = "https://empresa.com/" + "a".repeat(500);
    expect(validateAdDestinationUrl(long).ok).toBe(false);
  });

  it("rejeita localhost", () => {
    expect(validateAdDestinationUrl("https://localhost/pagina").ok).toBe(false);
  });

  it("rejeita IP privado (192.168.x.x)", () => {
    expect(validateAdDestinationUrl("https://192.168.1.1/pagina").ok).toBe(false);
  });

  it("rejeita caminho relativo por padrão", () => {
    expect(validateAdDestinationUrl("/auth/cadastro-anunciante").ok).toBe(false);
  });

  it("aceita caminho relativo quando allowRelative é true", () => {
    expect(validateAdDestinationUrl("/auth/cadastro-anunciante", { allowRelative: true })).toEqual({
      ok: true,
      url: "/auth/cadastro-anunciante",
    });
  });

  it("continua rejeitando protocolo perigoso mesmo com allowRelative true", () => {
    expect(validateAdDestinationUrl("javascript:alert(1)", { allowRelative: true }).ok).toBe(false);
  });

  it("rejeita IPv6 loopback com brackets [::1]", () => {
    expect(validateAdDestinationUrl("https://[::1]/pagina").ok).toBe(false);
  });

  it("rejeita localhost com trailing dot", () => {
    expect(validateAdDestinationUrl("https://localhost./pagina").ok).toBe(false);
  });

  it("rejeita outros endereços no range 127.0.0.0/8", () => {
    expect(validateAdDestinationUrl("https://127.0.0.2/pagina").ok).toBe(false);
  });

  it("rejeita cloud metadata endpoint 169.254.169.254", () => {
    expect(validateAdDestinationUrl("https://169.254.169.254/pagina").ok).toBe(false);
  });
});
