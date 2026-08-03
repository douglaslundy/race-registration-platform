import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock, verify: vi.fn() })) },
}));

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));

vi.mock("@/lib/message-logs", () => ({
  recordMessageLog: vi.fn(),
}));

vi.mock("@/lib/templates/resolve", () => ({
  getEffectiveTemplate: vi.fn(),
}));

import { sendMail, sendLowStockEmail, sendAdvertiserRequestPendingEmail } from "@/lib/email";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { recordMessageLog } from "@/lib/message-logs";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

const smtpConfig = { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "noreply@example.com", secure: false };

describe("sendMail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("lança erro quando o SMTP não está configurado, sem tentar enviar", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);

    await expect(sendMail({ to: "a@b.com", subject: "Oi", html: "<p>Oi</p>" })).rejects.toThrow(
      "SMTP não configurado",
    );
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, registra o log como SENT", async () => {
    sendMailMock.mockResolvedValueOnce({});

    await sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>" });

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      subject: "Confirmação",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });
  });

  it("em caso de falha no envio, registra o log como FAILED e relança o erro original", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("Connection timeout"));

    await expect(sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>" })).rejects.toThrow(
      "Connection timeout",
    );

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      subject: "Confirmação",
      recipientAddress: "atleta@example.com",
      status: "FAILED",
      errorMessage: "Connection timeout",
    });
  });

  it("grava relatedEntityType/relatedEntityId no log quando informados no opts", async () => {
    sendMailMock.mockResolvedValueOnce({});

    await sendMail({
      to: "atleta@example.com",
      subject: "Inscrição confirmada",
      html: "<p>Oi</p>",
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      subject: "Inscrição confirmada",
      recipientAddress: "atleta@example.com",
      status: "SENT",
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });
  });

  it("repassa attachments pro transporter.sendMail quando fornecidos", async () => {
    sendMailMock.mockResolvedValueOnce({});
    const attachments = [{ filename: "relatorio.pdf", content: Buffer.from("PDF") }];

    await sendMail({
      to: "atleta@example.com",
      subject: "Relatório",
      html: "<p>Oi</p>",
      attachments,
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ attachments }),
    );
  });
});

describe("sendLowStockEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("usa o template resolvido (evento/global/fábrica) em vez de string fixa", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado {{nome_evento}}", body: "Vendeu {{vagas_vendidas}}/{{capacidade_lote}}", source: "global",
    });

    const { sendLowStockEmail: importedFunc } = await import("@/lib/email");
    await importedFunc({ to: "org@example.com", organizerName: "Org", eventTitle: "Corrida X", batchName: "Lote 1", soldCount: 95, capacity: 100 });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("LOW_STOCK", "EMAIL", "ORGANIZER");
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "org@example.com",
    }));
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Vendeu 95/100");
  });
});

describe("sendAdvertiserRequestPendingEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("usa o template resolvido em vez de string fixa", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Nova solicitação — {{nome_plataforma}}", body: "Empresa: {{empresa_anunciante}}, plano: {{nome_plano}}, link: {{link_solicitacoes_pendentes}}", source: "global",
    });

    await sendAdvertiserRequestPendingEmail({ to: "admin@example.com", companyName: "Empresa X", planName: "Plano Básico" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("ADVERTISER_REQUEST_PENDING", "EMAIL", "ADMIN");
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.com",
    }));
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Empresa: Empresa X, plano: Plano Básico");
  });
});

describe("sendAbandonedCartEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("usa o template resolvido em vez de string fixa", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Finalize já — {{nome_evento}}", body: "Olá {{nome_atleta}}, link: {{link_finalizar_pagamento}}", source: "global",
    });

    const { sendAbandonedCartEmail } = await import("@/lib/email");
    await sendAbandonedCartEmail({ to: "atleta@example.com", name: "Maria", eventTitle: "Corrida X", orderId: "ord-1" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("ABANDONED_CART", "EMAIL", "BUYER");
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá Maria");
  });
});
