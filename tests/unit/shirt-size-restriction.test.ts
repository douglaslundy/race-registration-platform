import { describe, expect, it } from "vitest";
import { getAllowedShirtSizes, ALL_SHIRT_SIZES } from "@/lib/shirt-size-restriction";

describe("getAllowedShirtSizes", () => {
  it("retorna todos os tamanhos quando não há restrição configurada", () => {
    const result = getAllowedShirtSizes({ shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] });
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });

  it("retorna todos os tamanhos quando a data de corte ainda não chegou", () => {
    const now = new Date("2026-08-12T12:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: ["G"] },
      now,
    );
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });

  it("retorna só os tamanhos configurados quando a data de corte já passou", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: ["G"] },
      now,
    );
    expect(result).toEqual(["G"]);
  });

  it("retorna os tamanhos configurados exatamente no instante da data de corte (inclusivo)", () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: cutoff, shirtSizeRestrictionSizes: ["G", "GG"] },
      cutoff,
    );
    expect(result).toEqual(["G", "GG"]);
  });

  it("cai de volta pra todos os tamanhos se a lista configurada vier vazia (defensivo)", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: [] },
      now,
    );
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });
});
