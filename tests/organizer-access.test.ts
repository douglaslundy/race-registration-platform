import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;

import {
  resolveOrganizerAccess,
  organizerNavItems,
  ORGANIZER_NAV,
} from "@/lib/auth/organizer-access";

const ORGANIZER = { user: { id: "org-1", role: "ORGANIZER", name: "Org" } } as any;
const ADMIN = { user: { id: "adm-1", role: "ADMIN", name: "Adm" } } as any;
const ASSISTANT = { user: { id: "as-1", role: "ASSISTANT", name: "As" } } as any;

/** ASSISTANT criado por um ORGANIZER (escopo de organizador, não admin). */
function assistantOfOrganizer() {
  dbMock.user.findUnique.mockResolvedValue({
    createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.assistantPermission.findFirst.mockResolvedValue(null);
  dbMock.assistantPermission.findMany.mockResolvedValue([]);
});

describe("resolveOrganizerAccess", () => {
  it("ORGANIZER titular acessa qualquer rota sem consultar o banco", async () => {
    expect(await resolveOrganizerAccess(ORGANIZER, "/organizador/relatorio")).toBe(true);
    expect(await resolveOrganizerAccess(ORGANIZER, "/organizador/eventos/e1/inscritos")).toBe(true);
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ADMIN acessa qualquer rota", async () => {
    expect(await resolveOrganizerAccess(ADMIN, "/organizador/assistentes")).toBe(true);
  });

  it("ASSISTANT de organizador SEM a permissão da rota é barrado", async () => {
    assistantOfOrganizer();
    dbMock.assistantPermission.findFirst.mockResolvedValue(null);
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/relatorio")).toBe(false);
  });

  it("ASSISTANT de organizador COM a permissão global da rota passa", async () => {
    assistantOfOrganizer();
    dbMock.assistantPermission.findFirst.mockResolvedValue({ id: "p1", eventId: null });
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/entrega-kits")).toBe(true);
  });

  it("ASSISTANT nunca acessa páginas só-titular (perfil, assistentes)", async () => {
    assistantOfOrganizer();
    dbMock.assistantPermission.findFirst.mockResolvedValue({ id: "p1", eventId: null });
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/assistentes")).toBe(false);
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/perfil")).toBe(false);
  });

  it("ASSISTANT escopado a um evento só acessa as páginas daquele evento", async () => {
    assistantOfOrganizer();
    // permissão kits.deliver só no evento e1
    dbMock.assistantPermission.findFirst.mockImplementation(({ where }: any) => {
      const scopes = where.OR ?? [{ eventId: where.eventId ?? null }];
      const okEvent = scopes.some((s: any) => s.eventId === "e1");
      return Promise.resolve(okEvent ? { id: "p1", eventId: "e1" } : null);
    });
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/eventos/e1/entrega-kits")).toBe(true);
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/eventos/e2/entrega-kits")).toBe(false);
  });

  it("ASSISTANT com kit só num evento específico ENTRA em /organizador/entrega-kits (launcher, anyScope)", async () => {
    assistantOfOrganizer();
    // só tem kits.deliver no evento e1 (linha com eventId != null) e NENHUMA linha global
    dbMock.assistantPermission.findFirst.mockImplementation(({ where }: any) => {
      // anyScope: a query NÃO tem where.OR nem where.eventId — casa qualquer linha de kit
      const isKit = where.actionKey.in.some((k: string) => k.startsWith("kits."));
      const noScopeFilter = where.OR === undefined && where.eventId === undefined;
      return Promise.resolve(isKit && noScopeFilter ? { id: "p1", eventId: "e1" } : null);
    });
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/entrega-kits")).toBe(true);
    // mas continua barrado no relatório (rota sem anyScope, exige linha global)
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/relatorio")).toBe(false);
  });

  it("rota desconhecida sob /organizador → nega pra assistente (fail-safe)", async () => {
    assistantOfOrganizer();
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/rota-nova-qualquer")).toBe(false);
  });

  it("pathname vazio (header ausente) → nega pra assistente", async () => {
    assistantOfOrganizer();
    expect(await resolveOrganizerAccess(ASSISTANT, "")).toBe(false);
  });

  it("ASSISTANT de admin (actingAsAdmin) passa em tudo", async () => {
    dbMock.user.findUnique.mockResolvedValue({ createdBy: { role: "ADMIN", organizerProfile: null } });
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador/assistentes")).toBe(true);
  });

  it("dashboard raiz: qualquer staff de organizador entra (é redirecionado na página)", async () => {
    assistantOfOrganizer();
    expect(await resolveOrganizerAccess(ASSISTANT, "/organizador")).toBe(true);
  });
});

describe("organizerNavItems", () => {
  it("titular vê todos os itens", async () => {
    expect((await organizerNavItems(ORGANIZER)).length).toBe(ORGANIZER_NAV.length);
  });

  it("assistente só vê itens cuja permissão ele tem, nunca os só-titular", async () => {
    assistantOfOrganizer();
    // tem kits.deliver (no evento e1) e nada mais
    dbMock.assistantPermission.findMany.mockImplementation(({ where }: any) => {
      const keys: string[] = where.actionKey.in;
      if (keys.includes("kits.deliver") || keys.includes("kits.view")) {
        return Promise.resolve([{ eventId: "e1" }]);
      }
      return Promise.resolve([]);
    });
    const items = await organizerNavItems(ASSISTANT);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toEqual(["/organizador/entrega-kits"]);
    expect(hrefs).not.toContain("/organizador/assistentes");
    expect(hrefs).not.toContain("/organizador/perfil");
    expect(hrefs).not.toContain("/organizador");
  });
});
