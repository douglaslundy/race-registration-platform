import { describe, expect, it } from "vitest";
import { renderTemplate, validateTemplateVariables } from "@/lib/templates/render";

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

  it("remove caracteres de controle no canal WHATSAPP", () => {
    expect(renderTemplate("{{x}}", { x: "a\x00b" }, "WHATSAPP")).toBe("ab");
  });

  it("corpo sem nenhuma variável retorna igual", () => {
    expect(renderTemplate("texto fixo", {}, "EMAIL")).toBe("texto fixo");
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
