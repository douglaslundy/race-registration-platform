import { describe, expect, it } from "vitest";
import { isWhatsAppConfigured } from "@/lib/whatsapp-settings";

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
