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

import {
  sendMail,
  sendLowStockEmail,
  sendAdvertiserRequestPendingEmail,
  sendReconciliationMismatchEmail,
  sendDailySummaryEmail,
  sendPaymentErrorEmail,
} from "@/lib/email";
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

describe("sendReconciliationMismatchEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  const mismatches = [
    { paymentId: "pay-1", orderId: "ord-1", eventTitle: "Corrida X", localStatus: "PENDING", gatewayStatus: "PAID", corrected: true },
    { paymentId: "pay-2", orderId: "ord-2", eventTitle: "Corrida Y", localStatus: "PENDING", gatewayStatus: "REFUNDED", corrected: false },
  ];

  it("usa o template resolvido (subject + introdução) em vez de string fixa; a tabela continua gerada em código", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      source: "global",
    });

    await sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", subject: "Assunto customizado — 2" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Intro 1/1");
    expect(sentHtml).toContain("Corrida X");
    expect(sentHtml).toContain("Corrida Y");
    expect(sentHtml).toContain("Aviso final");
  });

  it("preserva a ordem visual original: introdução, tabela de divergências e depois o aviso", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      source: "global",
    });

    await sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    const introIndex = sentHtml.indexOf("Intro 1/1");
    const tableIndex = sentHtml.indexOf("<table");
    const avisoIndex = sentHtml.indexOf("Aviso final");
    expect(introIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(introIndex);
    expect(avisoIndex).toBeGreaterThan(tableIndex);
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

describe("sendPaymentErrorEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("usa o template resolvido em vez de string fixa", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Cancelada — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, link: {{link_evento}}</p>",
      source: "global",
    });

    await sendPaymentErrorEmail({ to: "atleta@example.com", name: "Maria", eventTitle: "Corrida X", eventSlug: "corrida-x" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("PAYMENT_ERROR", "EMAIL", "BUYER");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", subject: "Cancelada — Corrida X" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá Maria");
  });

  it("com o template de fábrica do registry (mesmo texto do hardcoded anterior), assunto e corpo renderizam idênticos ao hardcoded anterior", async () => {
    sendMailMock.mockResolvedValueOnce({});
    const { getAlertDefinition } = await import("@/lib/templates/registry");
    const factory = getAlertDefinition("PAYMENT_ERROR")!.factoryDefault("EMAIL", "BUYER");
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: factory.subject,
      body: factory.body,
      source: "factory",
    });

    await sendPaymentErrorEmail({ to: "atleta@example.com", name: "Maria", eventTitle: "Corrida X", eventSlug: "corrida-x" });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "atleta@example.com",
        subject: "Inscrição cancelada — pagamento não identificado — Corrida X",
      }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá Maria,");
    expect(sentHtml).toContain(
      "Não conseguimos identificar o pagamento da sua inscrição em <strong>Corrida X</strong>, por isso ela foi cancelada.",
    );
    expect(sentHtml).toContain(`href="${baseUrl}/eventos/corrida-x"`);
  });
});

describe("sendDailySummaryEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  const rows = [
    { label: "Inscrições pagas", value: "10" },
    { label: "Receita bruta", value: "R$ 1.000,00" },
  ];

  it("usa o template resolvido (subject + introdução) por papel; a tabela de métricas continua gerada em código", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado — {{data_resumo}}",
      body: "<p>Introdução customizada para {{papel_destinatario}} em {{data_resumo}}.</p>",
      source: "global",
    });

    await sendDailySummaryEmail({ to: "admin@example.com", role: "ADMIN", dateLabel: "03/08/2026", rows });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("DAILY_SUMMARY", "EMAIL", "ADMIN");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", subject: "Assunto customizado — 03/08/2026" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Introdução customizada para administrador em 03/08/2026.");
    expect(sentHtml).toContain("Inscrições pagas");
    expect(sentHtml).toContain("R$ 1.000,00");
  });

  it("preserva a ordem visual original: introdução e depois a tabela de métricas", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Resumo — {{data_resumo}}",
      body: "<p>Introdução {{papel_destinatario}}</p>",
      source: "global",
    });

    await sendDailySummaryEmail({ to: "org@example.com", role: "ORGANIZER", dateLabel: "03/08/2026", rows });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    const introIndex = sentHtml.indexOf("Introdução organizador");
    const tableIndex = sentHtml.indexOf("<table");
    expect(introIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(introIndex);
  });
});
