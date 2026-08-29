import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema PaymentAccount", () => {
  it("PaymentAccount está no dmmf com os campos esperados", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "PaymentAccount");
    expect(model).toBeDefined();
    const fields = model!.fields.map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining(["label", "provider", "accessToken", "webhookSecret", "publicKey", "isDefault", "archivedAt"]),
    );
  });

  it("Event e Payment têm paymentAccountId opcional", () => {
    for (const name of ["Event", "Payment"]) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
      const field = model.fields.find((f) => f.name === "paymentAccountId")!;
      expect(field.isRequired).toBe(false);
    }
  });
});
