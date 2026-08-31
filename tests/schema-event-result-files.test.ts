import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema EventResultFile", () => {
  const models = Prisma.dmmf.datamodel.models;

  it("EventResultFile existe com os campos certos", () => {
    const m = models.find((x) => x.name === "EventResultFile");
    expect(m).toBeDefined();
    const f = Object.fromEntries(m!.fields.map((x) => [x.name, x]));
    expect(f.label.isRequired).toBe(true);
    expect(f.fileUrl.isRequired).toBe(true);
    expect(f.fileName.isRequired).toBe(true);
    expect(f.eventId.isRequired).toBe(true);
    expect(f.createdById.isRequired).toBe(false);
  });

  it("Event.resultsSubtitle é opcional e Event tem a relação resultFiles", () => {
    const e = models.find((x) => x.name === "Event")!;
    expect(e.fields.find((x) => x.name === "resultsSubtitle")!.isRequired).toBe(false);
    expect(e.fields.find((x) => x.name === "resultFiles")).toBeDefined();
  });
});
