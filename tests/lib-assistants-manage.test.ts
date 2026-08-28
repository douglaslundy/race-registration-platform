import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/assistants/create-or-promote", () => ({ issueAssistantInvite: vi.fn() }));

import { deleteAssistant, resendAssistantInvite } from "@/lib/assistants/manage";
import { issueAssistantInvite } from "@/lib/assistants/create-or-promote";

const dbMock = db as any;

describe("deleteAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.assistantPermission.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.user.delete.mockResolvedValue({});
    dbMock.user.update.mockResolvedValue({});
  });

  it("404 quando o alvo não é ASSISTANT", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ATHLETE" });
    const r = await deleteAssistant({ assistantId: "a1" });
    expect(r).toEqual({ ok: false, error: "Assistente não encontrado", status: 404 });
  });

  it("404 quando o assistente é de outro criador (escopo organizador)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-2", email: "x@x.com", passwordHash: null,
    });
    const r = await deleteAssistant({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(r).toEqual({ ok: false, error: "Assistente não encontrado", status: 404 });
    expect(dbMock.user.delete).not.toHaveBeenCalled();
  });

  it("exclusão física quando nunca concluiu o cadastro (passwordHash null)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "novo@x.com", passwordHash: null,
    });
    const r = await deleteAssistant({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(dbMock.assistantPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: "a1" } });
    expect(dbMock.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: "novo@x.com" } });
    expect(dbMock.user.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(dbMock.user.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, mode: "deleted" });
  });

  it("rebaixa para ATHLETE quando já concluiu o cadastro (preserva integridade)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "ativo@x.com", passwordHash: "hash",
    });
    const r = await deleteAssistant({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(dbMock.user.delete).not.toHaveBeenCalled();
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { role: "ATHLETE", createdByUserId: null },
    });
    expect(r).toEqual({ ok: true, mode: "demoted" });
  });

  it("cai pro rebaixamento se a exclusão física falhar (FK inesperada)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "ghost@x.com", passwordHash: null,
    });
    dbMock.user.delete.mockRejectedValueOnce(new Error("P2003"));
    const r = await deleteAssistant({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { role: "ATHLETE", createdByUserId: null },
    });
    expect(r).toEqual({ ok: true, mode: "demoted" });
  });
});

describe("resendAssistantInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reenvia o convite para assistente que ainda não definiu senha", async () => {
    dbMock.user.findUnique
      .mockResolvedValueOnce({
        id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "pendente@x.com", passwordHash: null,
      })
      .mockResolvedValueOnce({ name: "Maria" });

    const r = await resendAssistantInvite({ assistantId: "a1", requireCreatedByUserId: "org-1", invitedByName: "Org" });
    expect(issueAssistantInvite).toHaveBeenCalledWith({ email: "pendente@x.com", name: "Maria", invitedByName: "Org" });
    expect(r).toEqual({ ok: true, inviteResent: true });
  });

  it("recusa reenvio para quem já concluiu o cadastro", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-1", email: "ativo@x.com", passwordHash: "hash",
    });
    const r = await resendAssistantInvite({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(r.ok).toBe(false);
    expect(issueAssistantInvite).not.toHaveBeenCalled();
  });

  it("404 para assistente de outro criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      id: "a1", role: "ASSISTANT", createdByUserId: "org-2", email: "x@x.com", passwordHash: null,
    });
    const r = await resendAssistantInvite({ assistantId: "a1", requireCreatedByUserId: "org-1" });
    expect(r).toEqual({ ok: false, error: "Assistente não encontrado", status: 404 });
  });
});
