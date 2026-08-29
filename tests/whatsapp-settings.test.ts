import { describe, expect, it } from "vitest";
import {
  isWhatsAppConfigured,
  isTwilioConfigured,
  normalizeTwilioFromNumber,
} from "@/lib/whatsapp-settings";

describe("isWhatsAppConfigured", () => {
  it("retorna true quando apiUrl, apiKey e instanceName estão todos preenchidos", () => {
    expect(
      isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" }),
    ).toBe(true);
  });

  it("retorna false quando apiUrl está vazio", () => {
    expect(isWhatsAppConfigured({ apiUrl: "", apiKey: "key", instanceName: "corridas-app" })).toBe(false);
  });

  it("retorna false quando apiKey está vazio", () => {
    expect(isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "", instanceName: "corridas-app" })).toBe(
      false,
    );
  });

  it("retorna false quando instanceName está vazio", () => {
    expect(
      isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "" }),
    ).toBe(false);
  });
});

describe("normalizeTwilioFromNumber", () => {
  it("mantém um E.164 já válido", () => {
    expect(normalizeTwilioFromNumber("+5511999999999")).toBe("+5511999999999");
  });

  it("apara espaços nas pontas", () => {
    expect(normalizeTwilioFromNumber("  +5511999999999  ")).toBe("+5511999999999");
  });

  it("coage um '+' na frente quando o valor salvo veio só com dígitos", () => {
    expect(normalizeTwilioFromNumber("5511999999999")).toBe("+5511999999999");
  });

  it("remove o prefixo 'whatsapp:' (o SDK espera só o E.164)", () => {
    expect(normalizeTwilioFromNumber("whatsapp:+5511999999999")).toBe("+5511999999999");
    expect(normalizeTwilioFromNumber("whatsapp:5511999999999")).toBe("+5511999999999");
  });
});

describe("isTwilioConfigured", () => {
  const ok = { accountSid: "AC123", authToken: "tok", fromNumber: "+55119", contentSid: "HX1" };

  it("retorna true quando todos os campos estão preenchidos e o SID começa com AC", () => {
    expect(isTwilioConfigured(ok)).toBe(true);
  });

  it("retorna false quando o accountSid não começa com AC (ex.: API Key SID 'SK…' ou typo)", () => {
    expect(isTwilioConfigured({ ...ok, accountSid: "SK123" })).toBe(false);
    expect(isTwilioConfigured({ ...ok, accountSid: "" })).toBe(false);
  });

  it("retorna false quando falta qualquer outro campo", () => {
    expect(isTwilioConfigured({ ...ok, authToken: "" })).toBe(false);
    expect(isTwilioConfigured({ ...ok, fromNumber: "" })).toBe(false);
    expect(isTwilioConfigured({ ...ok, contentSid: "" })).toBe(false);
  });
});
