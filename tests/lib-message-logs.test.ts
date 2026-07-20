import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  recordMessageLog,
  updateMessageLogStatusByProviderMessageId,
  listMessageLogs,
  resolveMessageOwnerUserId,
} from "@/lib/message-logs";

const dbMock = db as any;

describe("recordMessageLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.create.mockResolvedValue({});
  });

  it("resolve recipientUserId por e-mail exato quando channel é EMAIL", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1" });

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });

    expect(dbMock.user.findUnique).toHaveBeenCalledWith({ where: { email: "atleta@example.com" } });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        channel: "EMAIL",
        subject: "Assunto",
        recipientAddress: "atleta@example.com",
        recipientUserId: "user-1",
        status: "SENT",
        errorMessage: null,
        providerMessageId: null,
        sentAt: expect.any(Date),
      },
    });
  });

  it("resolve recipientUserId por telefone (findFirst) quando channel é WHATSAPP", async () => {
    dbMock.user.findFirst.mockResolvedValueOnce({ id: "user-2" });

    await recordMessageLog({
      channel: "WHATSAPP",
      subject: "Prévia da mensagem",
      recipientAddress: "5511999999999",
      status: "SENT",
      providerMessageId: "wamid.abc",
    });

    expect(dbMock.user.findFirst).toHaveBeenCalledWith({ where: { phone: "5511999999999" } });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        channel: "WHATSAPP",
        subject: "Prévia da mensagem",
        recipientAddress: "5511999999999",
        recipientUserId: "user-2",
        status: "SENT",
        errorMessage: null,
        providerMessageId: "wamid.abc",
        sentAt: expect.any(Date),
      },
    });
  });

  it("recipientUserId fica null quando não bate com nenhum usuário", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "extra@example.com",
      status: "SENT",
    });

    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientUserId: null }) }),
    );
  });

  it("status FAILED grava errorMessage e não seta sentAt", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "FAILED",
      errorMessage: "SMTP timeout",
    });

    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", errorMessage: "SMTP timeout", sentAt: null }),
      }),
    );
  });

  it("nunca lança erro quando a gravação do log falha (best-effort)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.messageLog.create.mockRejectedValueOnce(new Error("db down"));

    await expect(
      recordMessageLog({ channel: "EMAIL", subject: "x", recipientAddress: "a@b.com", status: "SENT" }),
    ).resolves.toBeUndefined();
  });
});

describe("updateMessageLogStatusByProviderMessageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza status e deliveredAt quando o ACK é DELIVERED e o status atual é SENT", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-1", status: "SENT" });

    await updateMessageLogStatusByProviderMessageId("wamid.abc", "DELIVERED");

    expect(dbMock.messageLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "DELIVERED", deliveredAt: expect.any(Date) },
    });
  });

  it("atualiza status e readAt quando o ACK é READ e o status atual é DELIVERED", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-2", status: "DELIVERED" });

    await updateMessageLogStatusByProviderMessageId("wamid.def", "READ");

    expect(dbMock.messageLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: { status: "READ", readAt: expect.any(Date) },
    });
  });

  it("não regride: ignora DELIVERED se o status atual já é READ", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-3", status: "READ" });

    await updateMessageLogStatusByProviderMessageId("wamid.ghi", "DELIVERED");

    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });

  it("ignora silenciosamente quando providerMessageId não bate com nenhuma linha", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce(null);

    await expect(updateMessageLogStatusByProviderMessageId("wamid.unknown", "READ")).resolves.toBeUndefined();
    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });
});

describe("listMessageLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.findMany.mockResolvedValue([]);
    dbMock.messageLog.count.mockResolvedValue(0);
  });

  it("filtra por channel e pagina com o padrão de 20 por página", async () => {
    await listMessageLogs({ channel: "EMAIL" });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channel: "EMAIL" },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("escopo do organizador: inclui recipientUserId quando informado", async () => {
    await listMessageLogs({ channel: "WHATSAPP", recipientUserId: "org-user-1" });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channel: "WHATSAPP", recipientUserId: "org-user-1" } }),
    );
  });

  it("sem channel, lista todos os canais misturados (where sem channel)", async () => {
    await listMessageLogs({});

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { createdAt: "desc" } }),
    );
  });

  it("combina status, busca e intervalo de data no where", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-10T00:00:00.000Z");

    await listMessageLogs({ channel: "EMAIL", status: "FAILED", q: "joão", from, to });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: "EMAIL",
          status: "FAILED",
          OR: [
            { recipientAddress: { contains: "joão", mode: "insensitive" } },
            { recipientUser: { name: { contains: "joão", mode: "insensitive" } } },
          ],
          createdAt: { gte: from, lte: to },
        },
      }),
    );
  });
});

describe("resolveMessageOwnerUserId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ORGANIZER: retorna o próprio id, sem consultar o banco", async () => {
    const id = await resolveMessageOwnerUserId({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    expect(id).toBe("org-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT: resolve o createdByUserId do criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-owner-1" });
    const id = await resolveMessageOwnerUserId({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "assistant-1" },
      select: { createdByUserId: true },
    });
    expect(id).toBe("org-owner-1");
  });

  it("qualquer outro papel (ex.: ADMIN visitando a tela do organizador): retorna null", async () => {
    const id = await resolveMessageOwnerUserId({ user: { id: "admin-1", role: "ADMIN" } } as any);
    expect(id).toBeNull();
  });
});
