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

  it("M8 — rejeita IP em decimal (2130706433 = 127.0.0.1)", () => {
    expect(validateAdDestinationUrl("https://2130706433/pagina").ok).toBe(false);
  });

  it("M8 — rejeita IP em hex (0x7f000001)", () => {
    expect(validateAdDestinationUrl("https://0x7f000001/").ok).toBe(false);
  });

  it("M8 — rejeita IP octal parcial (0177.0.0.1)", () => {
    expect(validateAdDestinationUrl("https://0177.0.0.1/").ok).toBe(false);
  });

  it("M8 — rejeita metadata via decimal (169.254.169.254 = 2852039166)", () => {
    expect(validateAdDestinationUrl("https://2852039166/latest/meta-data/").ok).toBe(false);
  });

  it("M8 — rejeita IPv6 ULA fc00::/7", () => {
    expect(validateAdDestinationUrl("https://[fd00::1]/").ok).toBe(false);
    expect(validateAdDestinationUrl("https://[fc00::1]/").ok).toBe(false);
  });

  it("M8 — rejeita IPv6 link-local fe80::/10", () => {
    expect(validateAdDestinationUrl("https://[fe80::1]/").ok).toBe(false);
  });

  it("M8 — rejeita IPv4 mapeado em IPv6 [::ffff:169.254.169.254]", () => {
    expect(validateAdDestinationUrl("https://[::ffff:169.254.169.254]/").ok).toBe(false);
  });

  it("M8 — rejeita URL com credenciais (userinfo)", () => {
    expect(validateAdDestinationUrl("https://metadata@169.254.169.254/").ok).toBe(false);
    expect(validateAdDestinationUrl("https://user:pass@empresa.com/").ok).toBe(false);
  });

  it("M8 — rejeita CGNAT 100.64.0.0/10", () => {
    expect(validateAdDestinationUrl("https://100.64.1.1/").ok).toBe(false);
  });

  it("M8 — continua aceitando um host público normal", () => {
    expect(validateAdDestinationUrl("https://example.com/x").ok).toBe(true);
    expect(validateAdDestinationUrl("https://8.8.8.8/x").ok).toBe(true);
  });
});
