import { describe, expect, it } from "vitest";
import { z } from "zod";
import { emptyStringToUndefined, extractApiErrorMessage, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";

describe("checkout validation helpers", () => {
  it("treats empty strings as undefined for optional fields", () => {
    const schema = z.object({
      routeId: optionalOpaqueIdField(),
      shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
    });

    const parsed = schema.parse({ routeId: "", shirtSize: "" });
    expect(parsed.routeId).toBeUndefined();
    expect(parsed.shirtSize).toBeUndefined();
  });

  it("accepts opaque internal ids that are not cuid", () => {
    expect(opaqueIdField().parse("legacy-batch-123")).toBe("legacy-batch-123");
    expect(optionalOpaqueIdField().parse("legacy-route-456")).toBe("legacy-route-456");
  });

  it("keeps valid values intact", () => {
    expect(emptyStringToUndefined("")).toBeUndefined();
    expect(emptyStringToUndefined("abc")).toBe("abc");
  });

  it("extracts meaningful api errors", () => {
    expect(extractApiErrorMessage({ error: "Falha ao processar" })).toBe("Falha ao processar");
    expect(extractApiErrorMessage({ formErrors: ["Campo obrigatório"] })).toBe("Campo obrigatório");
  });
});
