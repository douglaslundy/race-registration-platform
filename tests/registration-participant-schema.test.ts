import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema snapshot de inscrição", () => {
  it("Registration tem os 6 participant*", () => {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === "Registration")!;
    const f = Object.fromEntries(m.fields.map((x) => [x.name, x]));
    expect(f.participantName.isRequired).toBe(true);
    expect(f.participantEmail.isRequired).toBe(true);
    for (const n of ["participantPhone", "participantBirthDate", "participantGender", "participantCpf"]) {
      expect(f[n].isRequired).toBe(false);
    }
  });
  it("Event tem registrationEditDeadline opcional", () => {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === "Event")!;
    expect(m.fields.find((x) => x.name === "registrationEditDeadline")!.isRequired).toBe(false);
  });
});
