import { describe, expect, it } from "vitest";
import { WhatsAppSendError, whatsAppErrorLabel } from "@/lib/whatsapp/errors";

describe("WhatsAppSendError", () => {
  it("carrega kind e providerCode e é instanceof Error", () => {
    const e = new WhatsAppSendError("AUTH", "credenciais inválidas", "20003");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("AUTH");
    expect(e.providerCode).toBe("20003");
    expect(e.name).toBe("WhatsAppSendError");
  });

  it("whatsAppErrorLabel devolve um texto pt-BR por kind", () => {
    expect(whatsAppErrorLabel("INVALID_NUMBER")).toMatch(/número/i);
    expect(whatsAppErrorLabel("RATE_LIMITED")).toMatch(/limite/i);
    expect(whatsAppErrorLabel("PROVIDER_UNAVAILABLE")).toMatch(/indispon/i);
    expect(whatsAppErrorLabel("TIMEOUT")).toMatch(/tempo/i);
  });
});
