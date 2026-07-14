import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

import {
  resolveActingScope,
  checkApiPermission,
  checkAdminOnlyApiPermission,
  requireAdmin,
  requireOrganizer,
} from "@/lib/auth/rbac";
import { redirect } from "next/navigation";

describe("resolveActingScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN titular: actingAsAdmin=true, sem consulta ao banco", async () => {
    const scope = await resolveActingScope({ user: { id: "admin-1", role: "ADMIN" } } as any);
    expect(scope).toEqual({ actingAsAdmin: true, organizerId: null });
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("ORGANIZER titular: resolve o próprio organizerId", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    const scope = await resolveActingScope({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    expect(dbMock.organizerProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "org-user-1" } });
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: "org-1" });
  });

  it("ASSISTANT criado por ADMIN: actingAsAdmin=true", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ADMIN", organizerProfile: null },
    });
    const scope = await resolveActingScope({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: true, organizerId: null });
  });

  it("ASSISTANT criado por ORGANIZER: resolve o organizerId do criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-5" } },
    });
    const scope = await resolveActingScope({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: "org-5" });
  });

  it("ASSISTANT órfão (criador excluído): sem escopo nenhum", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: null });
    const scope = await resolveActingScope({ user: { id: "assistant-3", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: null });
  });

  it("ATHLETE: sem escopo nenhum, sem consulta ao banco", async () => {
    const scope = await resolveActingScope({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: null });
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("checkApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(401);
  });

  it("ADMIN sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ORGANIZER sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const result = await checkApiPermission("events.edit");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT com a permissão concedida é permitido", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    const result = await checkApiPermission("events.approve");
    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "events.approve" } },
    });
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });

  it("ATHLETE é barrado com 403, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });
});

describe("checkAdminOnlyApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(401);
  });

  it("ADMIN sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN com a permissão concedida é permitido", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT criado por ORGANIZER com a permissão concedida (mas actingAsAdmin=false) é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });

  it("ORGANIZER titular é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN passa sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const session = await requireAdmin();
    expect(session.user.id).toBe("admin-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    const session = await requireAdmin();
    expect(session.user.id).toBe("assistant-1");
  });

  it("ASSISTANT criado por ORGANIZER é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/acesso-negado");
  });

  it("ATHLETE é redirecionado sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireOrganizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ORGANIZER passa sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const session = await requireOrganizer();
    expect(session.user.id).toBe("org-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ORGANIZER passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    const session = await requireOrganizer();
    expect(session.user.id).toBe("assistant-2");
  });

  it("ASSISTANT órfão é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-3", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: null });
    await expect(requireOrganizer()).rejects.toThrow("NEXT_REDIRECT");
  });
});
