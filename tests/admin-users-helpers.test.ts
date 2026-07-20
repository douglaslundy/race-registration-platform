import { describe, expect, it } from "vitest";
import { buildAdminUserWhere, buildAdminUserOrderBy } from "@/lib/admin/users";

describe("buildAdminUserWhere", () => {
  it("returns an empty filter when no params given", () => {
    expect(buildAdminUserWhere({})).toEqual({});
  });

  it("searches by name or email when q has no digits", () => {
    expect(buildAdminUserWhere({ q: "maria" })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: "maria", mode: "insensitive" } },
            { email: { contains: "maria", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("also matches CPF (own or athlete profile) when q contains digits", () => {
    expect(buildAdminUserWhere({ q: "111.444.777-35" })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: "111.444.777-35", mode: "insensitive" } },
            { email: { contains: "111.444.777-35", mode: "insensitive" } },
            { cpf: { contains: "11144477735" } },
            { athleteProfile: { cpf: { contains: "11144477735" } } },
          ],
        },
      ],
    });
  });
});

describe("buildAdminUserOrderBy", () => {
  it("ordena por lastLoginAt (desc), com quem nunca acessou sempre por último", () => {
    expect(buildAdminUserOrderBy("lastLoginAt", "desc")).toEqual({
      orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      normalizedSort: "lastLoginAt",
      normalizedDir: "desc",
    });
  });

  it("ordena por lastLoginAt (asc), com quem nunca acessou sempre por último", () => {
    expect(buildAdminUserOrderBy("lastLoginAt", "asc")).toEqual({
      orderBy: [{ lastLoginAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      normalizedSort: "lastLoginAt",
      normalizedDir: "asc",
    });
  });
});
