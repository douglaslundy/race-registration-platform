import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;

import { adminAssistantItems, adminNavHrefs, resolveAdminAccess } from "@/lib/auth/admin-access";

const ADMIN = { user: { id: "adm-1", role: "ADMIN" } } as any;
const ASSISTANT = { user: { id: "as-1", role: "ASSISTANT" } } as any;
const ATHLETE = { user: { id: "at-1", role: "ATHLETE" } } as any;

/** Assistente que só tem kits.deliver (num evento específico). */
function kitsOnly() {
  dbMock.assistantPermission.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.actionKey.in.includes("kits.deliver") ? { id: "p1" } : null),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.assistantPermission.findFirst.mockResolvedValue(null);
});

describe("resolveAdminAccess", () => {
  it("ADMIN acessa qualquer rota", async () => {
    expect(await resolveAdminAccess(ADMIN, "/admin/usuarios")).toBe(true);
  });

  it("outros papéis são negados", async () => {
    expect(await resolveAdminAccess(ATHLETE, "/admin/entrega-kits")).toBe(false);
  });

  it("assistente só de kits entra em entrega-kits e é barrado no resto", async () => {
    kitsOnly();
    expect(await resolveAdminAccess(ASSISTANT, "/admin/entrega-kits")).toBe(true);
    expect(await resolveAdminAccess(ASSISTANT, "/admin/usuarios")).toBe(false);
    expect(await resolveAdminAccess(ASSISTANT, "/admin/pagamentos")).toBe(false);
    expect(await resolveAdminAccess(ASSISTANT, "/admin")).toBe(false);
    expect(await resolveAdminAccess(ASSISTANT, "/admin/campanhas")).toBe(false);
  });

  it("assistente sem nenhuma permissão é barrado até em entrega-kits", async () => {
    expect(await resolveAdminAccess(ASSISTANT, "/admin/entrega-kits")).toBe(false);
  });
});

describe("adminNavHrefs", () => {
  it("ADMIN vê tudo (null)", async () => {
    expect(await adminNavHrefs(ADMIN)).toBeNull();
  });

  it("assistente só de kits vê só Entrega de kits", async () => {
    kitsOnly();
    expect(await adminNavHrefs(ASSISTANT)).toEqual(["/admin/entrega-kits"]);
  });
});

describe("adminAssistantItems", () => {
  it("devolve href + rótulo só do que o assistente pode", async () => {
    kitsOnly();
    expect(await adminAssistantItems(ASSISTANT)).toEqual([{ href: "/admin/entrega-kits", label: "Entrega de kits" }]);
  });
});
