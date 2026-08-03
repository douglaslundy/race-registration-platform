import { describe, expect, it } from "vitest";
import { ALL_VARIABLES, getVariablesByNames } from "@/lib/templates/variables";

describe("ALL_VARIABLES", () => {
  it("não tem nomes duplicados", () => {
    const names = ALL_VARIABLES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("todo nome usa snake_case sem espaços", () => {
    for (const v of ALL_VARIABLES) {
      expect(v.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("toda variável do catálogo tem um valor de amostra não vazio (usado no preview/test-send)", () => {
    for (const v of ALL_VARIABLES) {
      expect(v.sample, `variável "${v.name}" está sem sample`).toBeTruthy();
      expect(v.sample.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getVariablesByNames", () => {
  it("retorna só as variáveis pedidas, na ordem do catálogo", () => {
    const result = getVariablesByNames(["nome_evento", "nome_atleta"]);
    expect(result.map((v) => v.name)).toEqual(["nome_atleta", "nome_evento"]);
  });

  it("ignora nomes desconhecidos silenciosamente", () => {
    expect(getVariablesByNames(["nao_existe"])).toEqual([]);
  });
});
