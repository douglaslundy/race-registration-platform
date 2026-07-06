import { describe, expect, it } from "vitest";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";

describe("buildRegistrationOrderBy", () => {
  it("defaults to chronological ascending when no params given", () => {
    const result = buildRegistrationOrderBy("", "");
    expect(result).toEqual({ orderBy: { createdAt: "asc" }, normalizedSort: "date", normalizedDir: "asc" });
  });

  it("sorts alphabetically by athlete name", () => {
    const result = buildRegistrationOrderBy("name", "asc");
    expect(result).toEqual({ orderBy: { athlete: { name: "asc" } }, normalizedSort: "name", normalizedDir: "asc" });
  });

  it("sorts chronologically descending", () => {
    const result = buildRegistrationOrderBy("date", "desc");
    expect(result).toEqual({ orderBy: { createdAt: "desc" }, normalizedSort: "date", normalizedDir: "desc" });
  });

  it("treats any non-desc dir as ascending", () => {
    const result = buildRegistrationOrderBy("name", "sideways");
    expect(result.normalizedDir).toBe("asc");
  });
});

describe("buildRegistrationWhere", () => {
  it("filters by eventId only when no status given", () => {
    expect(buildRegistrationWhere("evt-1")).toEqual({ eventId: "evt-1" });
  });

  it("adds status filter when a valid status is given", () => {
    expect(buildRegistrationWhere("evt-1", "CONFIRMED")).toEqual({ eventId: "evt-1", status: "CONFIRMED" });
  });

  it("ignores invalid status values", () => {
    expect(buildRegistrationWhere("evt-1", "NOT_A_STATUS")).toEqual({ eventId: "evt-1" });
  });

  it("ignores empty string status", () => {
    expect(buildRegistrationWhere("evt-1", "")).toEqual({ eventId: "evt-1" });
  });

  it("searches by order id, athlete name and email when q has no digits", () => {
    expect(buildRegistrationWhere("evt-1", "", "maria")).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "maria", mode: "insensitive" } },
        { athlete: { name: { contains: "maria", mode: "insensitive" } } },
        { athlete: { email: { contains: "maria", mode: "insensitive" } } },
      ],
    });
  });

  it("also matches athlete CPF when q contains digits", () => {
    expect(buildRegistrationWhere("evt-1", "", "111.444.777-35")).toEqual({
      eventId: "evt-1",
      OR: [
        { orderId: { contains: "111.444.777-35", mode: "insensitive" } },
        { athlete: { name: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { email: { contains: "111.444.777-35", mode: "insensitive" } } },
        { athlete: { athleteProfile: { cpf: { contains: "11144477735" } } } },
      ],
    });
  });
});
