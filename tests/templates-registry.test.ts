import { describe, expect, it } from "vitest";
import { ALERT_REGISTRY, getAlertDefinition } from "@/lib/templates/registry";
import { ALL_VARIABLES } from "@/lib/templates/variables";

const KNOWN_VARIABLE_NAMES = new Set(ALL_VARIABLES.map((v) => v.name));

describe("ALERT_REGISTRY", () => {
  it("toda entrada só declara variáveis que existem no catálogo geral", () => {
    for (const def of Object.values(ALERT_REGISTRY)) {
      for (const varName of def.variables) {
        expect(KNOWN_VARIABLE_NAMES.has(varName)).toBe(true);
      }
    }
  });

  it("toda entrada tem pelo menos 1 canal e 1 papel de destinatário", () => {
    for (const def of Object.values(ALERT_REGISTRY)) {
      expect(def.channels.length).toBeGreaterThan(0);
      expect(def.recipientRoles.length).toBeGreaterThan(0);
    }
  });

  it("factoryDefault de EMAIL sempre tem subject; de WHATSAPP nunca tem", () => {
    for (const def of Object.values(ALERT_REGISTRY)) {
      if (def.channels.includes("EMAIL")) {
        const result = def.factoryDefault("EMAIL", def.recipientRoles[0]);
        expect(result.subject).toBeTruthy();
      }
      if (def.channels.includes("WHATSAPP")) {
        const result = def.factoryDefault("WHATSAPP", def.recipientRoles[0]);
        expect(result.subject).toBeUndefined();
      }
    }
  });

  it("factoryDefault de LOW_STOCK usa o texto de e-mail atual de produção", () => {
    const result = ALERT_REGISTRY.LOW_STOCK.factoryDefault("EMAIL", "ORGANIZER");
    expect(result.subject).toBe("Vagas se esgotando — {{nome_evento}}");
    expect(result.body).toContain("{{nome_lote}}");
    expect(result.body).toContain("{{vagas_vendidas}}");
  });

  it("validateTemplateVariables aceita o corpo de fábrica de todo alerta/canal/papel declarado", async () => {
    const { validateTemplateVariables } = await import("@/lib/templates/render");
    for (const def of Object.values(ALERT_REGISTRY)) {
      for (const channel of def.channels) {
        for (const role of def.recipientRoles) {
          const { subject, body } = def.factoryDefault(channel, role);
          const fullText = `${subject ?? ""} ${body}`;
          const { valid, unknown } = validateTemplateVariables(fullText, def.variables);
          expect({ alertKey: def.alertKey, channel, role, valid, unknown }).toEqual({
            alertKey: def.alertKey, channel, role, valid: true, unknown: [],
          });
        }
      }
    }
  });
});

describe("getAlertDefinition", () => {
  it("retorna undefined para chave desconhecida", () => {
    expect(getAlertDefinition("NAO_EXISTE")).toBeUndefined();
  });
});
