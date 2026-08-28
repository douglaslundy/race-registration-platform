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
  checkAdvertiserApiPermission,
  requireAdmin,
  requireOrganizer,
  requirePermission,
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
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ORGANIZER sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const result = await checkApiPermission("events.edit");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ASSISTANT com a permissão concedida (global) é permitido", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    const result = await checkApiPermission("events.approve");
    expect(dbMock.assistantPermission.findFirst).toHaveBeenCalledWith({
      where: { userId: "assistant-1", actionKey: { in: ["events.approve"] }, eventId: null },
    });
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT com { eventId }: consulta linhas globais OU do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-e1" });
    const result = await checkApiPermission("kits.deliver", { eventId: "e1" });
    expect(dbMock.assistantPermission.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "assistant-1",
        actionKey: { in: ["kits.deliver"] },
        OR: [{ eventId: null }, { eventId: "e1" }],
      },
    });
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT restrito a e1 é negado em e2 e negado sem opts", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    // e2: só existe linha de e1 → findFirst com OR [null, e2] não acha
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);
    const inOther = await checkApiPermission("kits.deliver", { eventId: "e2" });
    expect(inOther.allowed).toBe(false);
    // sem opts: filtro eventId:null → linha restrita não conta
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);
    const noOpts = await checkApiPermission("kits.deliver");
    expect(noOpts.allowed).toBe(false);
  });

  it("ADMIN/ORGANIZER passam mesmo com { eventId }, sem consultar", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const result = await checkApiPermission("kits.deliver", { eventId: "e1" });
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ASSISTANT sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });

  it("ATHLETE é barrado com 403, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
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
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN com a permissão concedida é permitido", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    const result = await checkAdminOnlyApiPermission("events.approve");
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT criado por ORGANIZER com a permissão concedida (mas actingAsAdmin=false) é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
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

describe("checkAdvertiserApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão, sem consultar AdvertiserProfile", async () => {
    authMock.mockResolvedValue(null as any);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(401);
    expect(dbMock.advertiserProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna 403 quando o papel não é ADVERTISER, sem consultar AdvertiserProfile", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
    expect(dbMock.advertiserProfile.findUnique).not.toHaveBeenCalled();
  });

  it("ADVERTISER com perfil: allowed=true, advertiser preenchido", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    const result = await checkAdvertiserApiPermission();
    expect(dbMock.advertiserProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.advertiser).toEqual({ id: "advertiser-1" });
  });

  it("ADVERTISER sem perfil ainda: allowed=true, advertiser null (não decide 404 sozinho)", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.advertiser).toBeNull();
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

describe("requirePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN passa sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const session = await requirePermission("messages.view");
    expect(session.user.id).toBe("admin-1");
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ORGANIZER passa sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const session = await requirePermission("messages.view");
    expect(session.user.id).toBe("org-1");
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("ASSISTANT com a permissão concedida passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    const session = await requirePermission("messages.view");
    expect(dbMock.assistantPermission.findFirst).toHaveBeenCalledWith({
      where: { userId: "assistant-1", actionKey: { in: ["messages.view"] }, eventId: null },
    });
    expect(session.user.id).toBe("assistant-1");
  });

  it("ASSISTANT sem a permissão é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/acesso-negado");
  });

  it("ATHLETE é redirecionado sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMock.assistantPermission.findFirst).not.toHaveBeenCalled();
  });

  it("sem sessão é redirecionado pro login", async () => {
    authMock.mockResolvedValue(null as any);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });
});
