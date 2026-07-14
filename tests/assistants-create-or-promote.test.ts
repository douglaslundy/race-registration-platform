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
        { userId: "new-user-1", actionKey: "events.view" },
        { userId: "new-user-1", actionKey: "events.edit" },
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

  it("bloqueia quando o e-mail já pertence a um ASSISTANT existente", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "assistant-9", role: "ASSISTANT" });

    const result = await createOrPromoteAssistant({
      email: "ja-e-assistente@example.com",
      name: "X",
      actionKeys: [],
      createdByUserId: "admin-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
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
      data: [{ userId: "athlete-1", actionKey: "events.view" }],
    });
  });
});
