import { describe, expect, it } from "vitest";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

describe("buildSeoPrompt", () => {
  it("monta o prompt de evento com dados do evento e contexto de marca", () => {
    const prompt = buildSeoPrompt({
      kind: "event",
      field: "metaTitle",
      title: "Corrida da Serra",
      description: "Uma corrida linda.",
      city: "Belo Horizonte",
      state: "MG",
      modality: "TRAIL_RUN",
      startAt: new Date("2026-09-01T09:00:00Z"),
      brandContext: "plataforma de inscrições esportivas",
    });

    expect(prompt).toContain("Corrida da Serra");
    expect(prompt).toContain("trail run");
    expect(prompt).toContain("Belo Horizonte/MG");
    expect(prompt).toContain("plataforma de inscrições esportivas");
    expect(prompt).toContain("Máximo de 60 caracteres");
    expect(prompt).toContain("português do Brasil");
  });

  it("monta o prompt de descrição com limite de 155 caracteres", () => {
    const prompt = buildSeoPrompt({
      kind: "event",
      field: "metaDescription",
      title: "Corrida da Serra",
      description: null,
      city: "Belo Horizonte",
      state: "MG",
      modality: "ROAD_RACE",
      startAt: new Date("2026-09-01T09:00:00Z"),
      brandContext: null,
    });
    expect(prompt).toContain("Máximo de 155 caracteres");
    expect(prompt).not.toContain("Contexto do site");
  });

  it("monta o prompt do site usando o nome do app e o contexto de marca", () => {
    const prompt = buildSeoPrompt({
      kind: "site",
      field: "metaTitle",
      appName: "Circuito das Corridas",
      brandContext: "foco em corridas de rua no interior de MG",
    });
    expect(prompt).toContain("Circuito das Corridas");
    expect(prompt).toContain("foco em corridas de rua no interior de MG");
  });
});

describe("truncateSeoText", () => {
  it("corta o título em 70 caracteres", () => {
    const text = "a".repeat(100);
    expect(truncateSeoText(text, "metaTitle")).toHaveLength(70);
  });

  it("corta a descrição em 160 caracteres", () => {
    const text = "a".repeat(200);
    expect(truncateSeoText(text, "metaDescription")).toHaveLength(160);
  });

  it("remove espaços nas pontas antes de truncar", () => {
    expect(truncateSeoText("  título  ", "metaTitle")).toBe("título");
  });
});
