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
