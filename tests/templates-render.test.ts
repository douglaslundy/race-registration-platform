import { describe, expect, it } from "vitest";
import { renderTemplate, renderTemplateSubject, validateTemplateVariables } from "@/lib/templates/render";

describe("renderTemplate", () => {
  it("substitui uma variável conhecida", () => {
    expect(renderTemplate("Olá {{nome}}!", { nome: "Ana" }, "EMAIL")).toBe("Olá Ana!");
  });

  it("substitui múltiplas ocorrências da mesma variável", () => {
    expect(renderTemplate("{{nome}} e {{nome}} de novo", { nome: "X" }, "EMAIL")).toBe("X e X de novo");
  });

  it("variável sem valor no mapa vira string vazia, nunca 'undefined'", () => {
    expect(renderTemplate("Olá {{nome}}!", {}, "EMAIL")).toBe("Olá !");
  });

  it("faz HTML-escape do valor no canal EMAIL", () => {
    expect(renderTemplate("{{x}}", { x: "<script>alert(1)</script>" }, "EMAIL")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("não faz HTML-escape no canal WHATSAPP", () => {
    expect(renderTemplate("{{x}}", { x: "<b>oi</b>" }, "WHATSAPP")).toBe("<b>oi</b>");
  });

  it("remove caracteres de controle C0 no canal WHATSAPP", () => {
    expect(renderTemplate("{{x}}", { x: "a\x00b" }, "WHATSAPP")).toBe("ab");
  });

  it("remove DEL (\\x7F) no canal WHATSAPP", () => {
    expect(renderTemplate("{{x}}", { x: "a\x7Fb" }, "WHATSAPP")).toBe("ab");
  });

  it("remove caracteres de controle C1 (\\x9F) no canal WHATSAPP", () => {
    expect(renderTemplate("{{x}}", { x: "a\x9Fb" }, "WHATSAPP")).toBe("ab");
  });

  it("corpo sem nenhuma variável retorna igual", () => {
    expect(renderTemplate("texto fixo", {}, "EMAIL")).toBe("texto fixo");
  });
});

describe("renderTemplateSubject", () => {
  it("nunca faz HTML-escape (assunto é texto puro, não HTML)", () => {
    expect(renderTemplateSubject("{{x}}", { x: "Corrida & Cia" })).toBe("Corrida & Cia");
  });

  it("colapsa quebras de linha da variável pra espaço (ex.: redes_sociais com vários links separados por \\n)", () => {
    const result = renderTemplateSubject("Assunto: {{redes_sociais}}", {
      redes_sociais: "Segue no Instagram! https://instagram.com/corrida\nSegue no Twitter! https://twitter.com/corrida",
    });
    expect(result).toBe("Assunto: Segue no Instagram! https://instagram.com/corrida Segue no Twitter! https://twitter.com/corrida");
    expect(result).not.toContain("\n");
  });
});

describe("validateTemplateVariables", () => {
  it("aceita corpo só com variáveis permitidas", () => {
    const result = validateTemplateVariables("Olá {{nome}}, evento {{evento}}", ["nome", "evento"]);
    expect(result).toEqual({ valid: true, unknown: [] });
  });

  it("rejeita variável desconhecida e lista todas as desconhecidas", () => {
    const result = validateTemplateVariables("{{nome}} {{hack}} {{outra}}", ["nome"]);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(["hack", "outra"]);
  });

  it("corpo sem variáveis é sempre válido", () => {
    expect(validateTemplateVariables("texto fixo", [])).toEqual({ valid: true, unknown: [] });
  });
});
