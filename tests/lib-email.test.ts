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
  sendRegistrationConfirmationEmail,
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

    await expect(
      sendMail({ to: "a@b.com", subject: "Oi", html: "<p>Oi</p>", messageType: "LOW_STOCK" }),
    ).rejects.toThrow("SMTP não configurado");
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, registra o log como SENT", async () => {
    sendMailMock.mockResolvedValueOnce({});

    await sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>", messageType: "LOW_STOCK" });

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      messageType: "LOW_STOCK",
      subject: "Confirmação",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });
  });

  it("em caso de falha no envio, registra o log como FAILED e relança o erro original", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("Connection timeout"));

    await expect(
      sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>", messageType: "LOW_STOCK" }),
    ).rejects.toThrow("Connection timeout");

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      messageType: "LOW_STOCK",
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
      messageType: "ORDER_CONFIRMED",
      relatedEntityType: "Event",
      relatedEntityId: "event-1",
    });

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      messageType: "ORDER_CONFIRMED",
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
      messageType: "AD_REPORT",
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
    await importedFunc({ to: "org@example.com", organizerName: "Org", eventTitle: "Corrida X", batchName: "Lote 1", soldCount: 95, capacity: 100, eventId: "event-1" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");
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

  it("usa o rowTemplate resolvido pra montar cada linha da tabela, não mais hardcoded", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      rowTemplate: "<tr><td>Linha: {{evento}} / {{pedido}} / {{situacao}}</td></tr>",
      source: "global",
    });

    await sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Linha: Corrida X / ord-1 / Corrigido automaticamente");
    expect(sentHtml).toContain("Linha: Corrida Y / ord-2 / Requer verificação manual");
  });

  it("preserva a ordem visual original: introdução, tabela de divergências e depois o aviso", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      rowTemplate: "<tr><td>{{evento}}</td></tr>",
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

  it("sem rowTemplate resolvido (caso extremo), não lança — gera linhas vazias em vez de quebrar o envio", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto", body: "<p>Intro</p>", source: "global",
    });

    await expect(sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches })).resolves.toBeUndefined();
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
    await sendAbandonedCartEmail({ to: "atleta@example.com", name: "Maria", eventTitle: "Corrida X", orderId: "ord-1", eventId: "event-1" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("ABANDONED_CART", "EMAIL", "BUYER", "event-1");
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

    await sendPaymentErrorEmail({ to: "atleta@example.com", name: "Maria", eventTitle: "Corrida X", eventSlug: "corrida-x", eventId: "event-1" });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("PAYMENT_ERROR", "EMAIL", "BUYER", "event-1");
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

describe("sendRegistrationConfirmationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("resolve o template com alertKey/recipientRole do comprador confirmando a própria inscrição", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, pedido {{codigo_confirmacao}}, link {{link_evento}}</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
    });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("ORDER_CONFIRMED", "EMAIL", "BUYER", "event-1");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", subject: "Assunto customizado — Corrida X" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá Maria, pedido order-1");
  });

  it("resolve o template com alertKey/recipientRole do atleta convidado por procuração", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta-convidado@example.com",
      name: "João",
      registrationId: "reg-2",
      orderId: "order-2",
      eventTitle: "Corrida Y",
      alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
      recipientRole: "ATHLETE",
    });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("ORDER_CONFIRMED_PROXY_ATHLETE", "EMAIL", "ATHLETE", undefined);
  });

  it("preenche nome_comprador quando um template customizado da procuração usa essa variável (não fica em branco)", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, {{nome_comprador}} te inscreveu</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta-convidado@example.com",
      name: "João",
      registrationId: "reg-2",
      orderId: "order-2",
      eventTitle: "Corrida Y",
      alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
      recipientRole: "ATHLETE",
      buyerName: "Comprador Teste",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá João, Comprador Teste te inscreveu");
  });

  it("com o template de fábrica do registry (mesmo texto do hardcoded anterior), assunto e corpo renderizam idênticos ao hardcoded anterior", async () => {
    sendMailMock.mockResolvedValueOnce({});
    const { getAlertDefinition } = await import("@/lib/templates/registry");
    const factory = getAlertDefinition("ORDER_CONFIRMED")!.factoryDefault("EMAIL", "BUYER");
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({ subject: factory.subject, body: factory.body, source: "factory" });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      notes: "Chegarei atrasado",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", subject: "Inscrição confirmada — Corrida X 🏅" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Olá Maria,");
    expect(sentHtml).toContain("Sua inscrição em <strong>Corrida X</strong> foi <strong>confirmada</strong> com sucesso! 🎉");
    expect(sentHtml).toContain("Código do pedido: <strong>order-1</strong>");
    expect(sentHtml).toContain(`href="${baseUrl}/dashboard/inscricoes/reg-1"`);
    // notes não é renderizado (limitação aceita e documentada — motor de renderização sem
    // suporte a blocos condicionais; ver description do ORDER_CONFIRMED no registry).
    expect(sentHtml).not.toContain("Chegarei atrasado");
  });

  it("resolve {{link_patrocinio}} quando o evento tem um link de patrocínio cadastrado", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, veja também: {{link_patrocinio}}</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
      sponsorLink: "https://www.strava.com/routes/123",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("https://www.strava.com/routes/123");
  });

  it("resolve {{link_patrocinio}} pra string vazia quando o evento não tem link cadastrado", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Link: [{{link_patrocinio}}]</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Link: []");
  });
});

describe("sendSensitiveActionCodeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("sendSensitiveActionCodeEmail envia o código no corpo do e-mail com messageType correto", async () => {
    sendMailMock.mockResolvedValueOnce({});
    const { sendSensitiveActionCodeEmail } = await import("@/lib/email");
    await sendSensitiveActionCodeEmail({
      to: "admin@example.com",
      name: "Admin",
      code: "123456",
      actionLabel: "Confirmação de estorno de pagamento",
    });

    // sendMailMock é o mock do transporter do nodemailer (ver vi.mock("nodemailer") no topo
    // deste arquivo) — só recebe to/subject/html/attachments, não messageType (que é uso
    // interno de lib/email.ts pro recordMessageLog; ver padrão nos testes de sendMail acima).
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: expect.stringContaining("Confirmação de estorno de pagamento"),
        html: expect.stringContaining("123456"),
      }),
    );
    expect(recordMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "SENSITIVE_ACTION_CODE",
        recipientAddress: "admin@example.com",
        status: "SENT",
      }),
    );
  });
});

describe("sendDailySummaryEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("renderiza o corpo inteiro a partir do template — nenhuma tabela é gerada em código", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado — {{data_resumo}}",
      body: "<p>Introdução para {{papel_destinatario}} em {{data_resumo}}.</p><p>Inscrições: {{total_inscricoes_pagas}}, receita: {{receita_periodo}}</p>",
      source: "global",
    });

    await sendDailySummaryEmail({
      to: "admin@example.com",
      role: "ADMIN",
      dateLabel: "03/08/2026",
      metrics: { total_inscricoes_pagas: "10", receita_periodo: "R$ 1.000,00" },
    });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("DAILY_SUMMARY", "EMAIL", "ADMIN");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", subject: "Assunto customizado — 03/08/2026" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Introdução para administrador em 03/08/2026.");
    expect(sentHtml).toContain("Inscrições: 10, receita: R$ 1.000,00");
    // Sem tabela hardcoded — só o que o template devolveu.
    expect(sentHtml).not.toContain("<table");
  });

  it("um template customizado que referencia novas variáveis de taxa renderiza os valores supridos via params.metrics", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Resumo — {{data_resumo}}",
      body: "<p>Taxa da plataforma: {{taxa_plataforma}}. Taxa de serviço: {{taxa_servico}}.</p>",
      source: "global",
    });

    await sendDailySummaryEmail({
      to: "admin@example.com",
      role: "ADMIN",
      dateLabel: "03/08/2026",
      metrics: { taxa_plataforma: "R$ 150,00", taxa_servico: "R$ 45,00" },
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Taxa da plataforma: R$ 150,00. Taxa de serviço: R$ 45,00.");
  });
});
