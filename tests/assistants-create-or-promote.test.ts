import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAssistantInviteEmail: vi.fn(),
}));

import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAssistantInviteEmail } from "@/lib/email";

const dbMock = db as any;

describe("createOrPromoteAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("cria um usuário novo, dispara convite e grava as permissões", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.user.create.mockResolvedValueOnce({ id: "new-user-1", email: "maria@example.com", name: "Maria" });

    const result = await createOrPromoteAssistant({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.view", "events.edit"],
      createdByUserId: "admin-1",
    });

    expect(dbMock.user.create).toHaveBeenCalledWith({
      data: {
        email: "maria@example.com",
        name: "Maria",
        role: "ASSISTANT",
        createdByUserId: "admin-1",
        passwordHash: null,
      },
    });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "new-user-1", actionKey: "events.view", eventId: null },
        { userId: "new-user-1", actionKey: "events.edit", eventId: null },
      ],
    });
    expect(dbMock.verificationToken.create).toHaveBeenCalled();
    expect(sendAssistantInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", name: "Maria" }),
    );
    expect(result).toEqual({ ok: true, userId: "new-user-1", isNew: true });
  });

  it("promove um ATHLETE existente sem disparar convite nem apagar dados", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "joao@example.com", role: "ATHLETE" });
    dbMock.user.update.mockResolvedValueOnce({ id: "athlete-1" });

    const result = await createOrPromoteAssistant({
      email: "joao@example.com",
      name: "João",
      actionKeys: ["events.view"],
      createdByUserId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "athlete-1" },
      data: { role: "ASSISTANT", createdByUserId: "org-1", name: "João" },
    });
    expect(dbMock.user.create).not.toHaveBeenCalled();
    expect(sendAssistantInviteEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, userId: "athlete-1", isNew: false });
  });

  it("bloqueia quando o e-mail já pertence a uma conta titular (ADMIN)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "admin-2", role: "ADMIN" });

    const result = await createOrPromoteAssistant({
      email: "outro-admin@example.com",
      name: "X",
      actionKeys: [],
      createdByUserId: "admin-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.",
      status: 400,
    });
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("bloqueia quando o e-mail já é assistente de OUTRO responsável", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "assistant-9", role: "ASSISTANT", createdByUserId: "org-2" });

    const result = await createOrPromoteAssistant({
      email: "ja-e-assistente@example.com",
      name: "X",
      actionKeys: [],
      createdByUserId: "admin-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(dbMock.user.delete).not.toHaveBeenCalled();
  });

  it("reenvia o convite e atualiza permissões quando o e-mail já é assistente PENDENTE do MESMO criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "assistant-pend",
      email: "pendente@example.com",
      role: "ASSISTANT",
      createdByUserId: "org-1",
      passwordHash: null,
    });
    dbMock.user.update.mockResolvedValueOnce({ id: "assistant-pend" });

    const result = await createOrPromoteAssistant({
      email: "pendente@example.com",
      name: "Maria",
      actionKeys: ["kits.deliver"],
      createdByUserId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "assistant-pend" },
      data: { name: "Maria", active: true },
    });
    expect(dbMock.verificationToken.create).toHaveBeenCalled(); // token novo gerado
    expect(sendAssistantInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "pendente@example.com" }),
    );
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "assistant-pend", actionKey: "kits.deliver", eventId: null }],
    });
    expect(result).toEqual({ ok: true, userId: "assistant-pend", isNew: false, inviteResent: true });
  });

  it("NÃO reenvia convite quando o assistente do mesmo criador já concluiu o cadastro", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "assistant-ok",
      email: "ok@example.com",
      role: "ASSISTANT",
      createdByUserId: "org-1",
      passwordHash: "hash",
    });
    dbMock.user.update.mockResolvedValueOnce({ id: "assistant-ok" });

    const result = await createOrPromoteAssistant({
      email: "ok@example.com",
      name: "Maria",
      actionKeys: ["kits.deliver"],
      createdByUserId: "org-1",
    });

    expect(sendAssistantInviteEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, userId: "assistant-ok", isNew: false });
  });

  it("grava as permissões restritas ao eventId informado (novo usuário)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.user.create.mockResolvedValueOnce({ id: "new-2", email: "ana@example.com", name: "Ana" });

    await createOrPromoteAssistant({
      email: "ana@example.com",
      name: "Ana",
      actionKeys: ["kits.view", "kits.deliver"],
      createdByUserId: "org-1",
      eventId: "event-42",
    });

    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "new-2", actionKey: "kits.view", eventId: "event-42" },
        { userId: "new-2", actionKey: "kits.deliver", eventId: "event-42" },
      ],
    });
  });

  it("promove ATHLETE existente com escopo de evento", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-7", email: "p@example.com", role: "ATHLETE" });
    dbMock.user.update.mockResolvedValueOnce({ id: "athlete-7" });

    await createOrPromoteAssistant({
      email: "p@example.com",
      name: "Paulo",
      actionKeys: ["kits.deliver"],
      createdByUserId: "org-1",
      eventId: "event-9",
    });

    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "athlete-7", actionKey: "kits.deliver", eventId: "event-9" }],
    });
  });

  it("substitui o conjunto de permissões por completo ao promover um existente", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "joao@example.com", role: "ATHLETE" });
    dbMock.user.update.mockResolvedValueOnce({ id: "athlete-1" });

    await createOrPromoteAssistant({
      email: "joao@example.com",
      name: "João",
      actionKeys: ["events.view"],
      createdByUserId: "org-1",
    });

    expect(dbMock.assistantPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: "athlete-1" } });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "athlete-1", actionKey: "events.view", eventId: null }],
    });
  });
});
