import { describe, expect, it } from "vitest";
import { buildAdminAuditWhere } from "@/lib/admin/audit";

describe("buildAdminAuditWhere — filtro de ambiente", () => {
  it("sem filtro de ambiente, não adiciona nenhuma condição extra", () => {
    const where = buildAdminAuditWhere({});
    expect(where).toEqual({});
  });

  it("filtra por role ADMIN quando environment=ADMIN", () => {
    const where = buildAdminAuditWhere({ environment: "ADMIN" });
    expect(where).toEqual({ AND: [{ user: { role: "ADMIN" } }] });
  });

  it("filtra por role ORGANIZER quando environment=ORGANIZER", () => {
    const where = buildAdminAuditWhere({ environment: "ORGANIZER" });
    expect(where).toEqual({ AND: [{ user: { role: "ORGANIZER" } }] });
  });

  it("filtra por role ATHLETE quando environment=ATHLETE", () => {
    const where = buildAdminAuditWhere({ environment: "ATHLETE" });
    expect(where).toEqual({ AND: [{ user: { role: "ATHLETE" } }] });
  });

  it("filtra por userId nulo quando environment=SYSTEM", () => {
    const where = buildAdminAuditWhere({ environment: "SYSTEM" });
    expect(where).toEqual({ AND: [{ userId: null }] });
  });

  it("combina o filtro de ambiente com os filtros já existentes", () => {
    const where = buildAdminAuditWhere({ environment: "ORGANIZER", entity: "Event" });
    expect(where).toEqual({ AND: [{ entityType: "Event" }, { user: { role: "ORGANIZER" } }] });
  });
});
