import nodemailer from "nodemailer";
import { getSmtpConfig, isSmtpReady, type SmtpConfig } from "./smtp-settings";
import { getAppName } from "./settings";
import { recordMessageLog } from "./message-logs";
import { getEffectiveTemplate } from "./templates/resolve";
import { renderTemplate, renderTemplateSubject } from "./templates/render";

function buildTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

/** Envia um e-mail usando a configuração SMTP salva (ou variáveis de ambiente). */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) {
    throw new Error("SMTP não configurado. Configure em Admin → Configurações.");
  }
  const transporter = buildTransport(cfg);
  const relatedEntity =
    opts.relatedEntityType && opts.relatedEntityId
      ? { relatedEntityType: opts.relatedEntityType, relatedEntityId: opts.relatedEntityId }
      : {};

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
  } catch (err) {
    await recordMessageLog({
      channel: "EMAIL",
      subject: opts.subject,
      recipientAddress: opts.to,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      ...relatedEntity,
    });
    throw err;
  }

  await recordMessageLog({
    channel: "EMAIL",
    subject: opts.subject,
    recipientAddress: opts.to,
    status: "SENT",
    ...relatedEntity,
  });
}

/** Verifica a conexão SMTP e envia um e-mail de teste. */
export async function sendTestEmail(to: string): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) {
    throw new Error("SMTP não configurado. Preencha ao menos o host e o remetente.");
  }
  const appName = await getAppName();
  const transporter = buildTransport(cfg);
  await transporter.verify();
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject: `Teste de SMTP — ${appName}`,
    html: layout(
      appName,
      `<p>Este é um e-mail de teste enviado pelo painel administrativo.</p>
       <p>Se você recebeu esta mensagem, a configuração de SMTP está funcionando corretamente. ✅</p>`
    ),
  });
}

function layout(appName: string, body: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
    <h2 style="color:#111827">${appName}</h2>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="font-size:12px;color:#9ca3af">Esta é uma mensagem automática de ${appName}.</p>
  </div>`;
}

/** E-mail de confirmação de inscrição (enviado quando o pagamento é confirmado). */
export async function sendRegistrationConfirmationEmail(params: {
  to: string;
  name: string;
  registrationId: string;
  orderId: string;
  eventTitle?: string;
  eventId?: string;
  notes?: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes/${params.registrationId}`;
  await sendMail({
    to: params.to,
    subject: `Inscrição confirmada${params.eventTitle ? ` — ${params.eventTitle}` : ""} 🏅`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua inscrição${params.eventTitle ? ` em <strong>${params.eventTitle}</strong>` : ""} foi <strong>confirmada</strong> com sucesso! 🎉</p>
       <p>O pagamento foi aprovado e sua vaga está garantida.</p>
       <p>Código do pedido: <strong>${params.orderId}</strong></p>
       ${params.notes ? `<p>Observação registrada: ${params.notes}</p>` : ""}
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver detalhes da inscrição</a></p>`
    ),
    ...(params.eventId ? { relatedEntityType: "Event", relatedEntityId: params.eventId } : {}),
  });
}

/** E-mail de confirmação de compra de plano de anúncio (enviado quando o pagamento é aprovado). */
export async function sendAdPurchaseConfirmationEmail(params: {
  to: string;
  name: string;
  planName: string;
  endAt: Date;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Plano de anúncio confirmado — ${params.planName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Seu plano <strong>${params.planName}</strong> foi confirmado! Já pode cadastrar seus
       anúncios no painel do anunciante.</p>
       <p>Validade até: <strong>${params.endAt.toLocaleDateString("pt-BR")}</strong></p>`
    ),
  });
}

/** E-mail avisando o organizador que um atleta solicitou cancelamento (requer aprovação). */
export async function sendCancellationRequestedEmail(params: {
  to: string;
  athleteName: string;
  eventTitle?: string;
  reason: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Solicitação de cancelamento${params.eventTitle ? ` — ${params.eventTitle}` : ""}`,
    html: layout(
      appName,
      `<p>Olá,</p>
       <p><strong>${params.athleteName}</strong> solicitou o cancelamento da inscrição${params.eventTitle ? ` em <strong>${params.eventTitle}</strong>` : ""}.</p>
       <p><strong>Justificativa:</strong> ${params.reason}</p>
       <p>Acesse o painel do organizador para aprovar ou rejeitar esta solicitação.</p>`
    ),
  });
}

/** E-mail avisando o organizador que um lote está quase esgotado. */
export async function sendLowStockEmail(params: {
  to: string;
  organizerName: string;
  eventTitle: string;
  batchName: string;
  soldCount: number;
  capacity: number;
}): Promise<void> {
  const appName = await getAppName();
  const percent = Math.round((params.soldCount / params.capacity) * 100);
  const values = {
    nome_organizador: params.organizerName,
    nome_evento: params.eventTitle,
    nome_lote: params.batchName,
    vagas_vendidas: String(params.soldCount),
    capacidade_lote: String(params.capacity),
    percentual_vendido: String(percent),
  };
  const template = await getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}

/** E-mail avisando o atleta que o pedido está pendente há tempo demais. */
export async function sendAbandonedCartEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  orderId: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const values = {
    nome_atleta: params.name,
    nome_evento: params.eventTitle,
    link_finalizar_pagamento: `${baseUrl}/dashboard/inscricoes`,
  };
  const template = await getEffectiveTemplate("ABANDONED_CART", "EMAIL", "BUYER");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}

/** E-mail avisando o atleta que a inscrição foi cancelada por pagamento não identificado. */
export async function sendPaymentErrorEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  eventSlug: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/eventos/${params.eventSlug}`;
  await sendMail({
    to: params.to,
    subject: `Inscrição cancelada — pagamento não identificado — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Não conseguimos identificar o pagamento da sua inscrição em <strong>${params.eventTitle}</strong>, por isso ela foi cancelada.</p>
       <p>Não fique de fora! Faça agora mesmo uma nova inscrição e venha participar conosco.</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Fazer nova inscrição</a></p>`
    ),
  });
}

/** E-mail avisando o admin sobre divergências encontradas na conciliação de pagamentos. */
export async function sendReconciliationMismatchEmail(params: {
  to: string;
  mismatches: { paymentId: string; orderId: string; eventTitle: string; localStatus: string; gatewayStatus: string; corrected: boolean }[];
}): Promise<void> {
  const appName = await getAppName();
  const correctedCount = params.mismatches.filter((m) => m.corrected).length;
  const manualCount = params.mismatches.length - correctedCount;
  const rows = params.mismatches
    .map(
      (m) =>
        `<tr><td>${m.eventTitle}</td><td>${m.orderId}</td><td>${m.localStatus}</td><td>${m.gatewayStatus}</td><td>${m.corrected ? "Corrigido automaticamente" : "Requer verificação manual"}</td></tr>`,
    )
    .join("");
  await sendMail({
    to: params.to,
    subject: `Conciliação de pagamentos — ${params.mismatches.length} divergência(s) encontrada(s)`,
    html: layout(
      appName,
      `<p>A rotina de conciliação encontrou divergências entre o status local e o status no gateway de
       pagamento (${correctedCount} corrigida(s) automaticamente, ${manualCount} precisa(m) de revisão
       manual):</p>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <thead><tr><th>Evento</th><th>Pedido</th><th>Status local</th><th>Status no gateway</th><th>Situação</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       <p>Divergências marcadas como "Requer verificação manual" precisam de revisão em Admin →
       Conciliação.</p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
  to: string;
  name?: string;
  resetUrl: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Redefinição de senha — ${appName}`,
    html: layout(
      appName,
      `<p>Olá${params.name ? ` ${params.name}` : ""},</p>
       <p>Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova senha:</p>
       <p><a href="${params.resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Redefinir senha</a></p>
       <p style="font-size:13px;color:#6b7280">Se você não solicitou isso, ignore este e-mail. O link expira em 1 hora.</p>`
    ),
  });
}

/** E-mail de convite pra um novo usuário assistente definir a senha e acessar o sistema. */
export async function sendAssistantInviteEmail(params: {
  to: string;
  name: string;
  invitedByName: string;
  resetUrl: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Você foi convidado como assistente — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p><strong>${params.invitedByName}</strong> te convidou para acessar o ${appName} como usuário assistente.</p>
       <p>Clique no botão abaixo para definir sua senha e acessar sua conta:</p>
       <p><a href="${params.resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Definir senha e acessar</a></p>
       <p style="font-size:13px;color:#6b7280">Se você não esperava este convite, ignore este e-mail. O link expira em 1 hora.</p>`
    ),
  });
}

/** E-mail de convite pro atleta inscrito por procuração definir a senha e acessar a própria
 * conta/inscrição. Só é disparado quando o comprador informou um e-mail real (nunca pro
 * sintético). */
export async function sendProxyRegistrationInviteEmail(params: {
  to: string;
  name: string;
  invitedByName: string;
  resetUrl: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Você tem uma inscrição em ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p><strong>${params.invitedByName}</strong> criou uma inscrição pra você no ${appName}.</p>
       <p>Clique no botão abaixo para definir sua senha e acompanhar sua inscrição:</p>
       <p><a href="${params.resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Definir senha e acessar</a></p>
       <p style="font-size:13px;color:#6b7280">Se você não esperava este convite, ignore este e-mail. O link expira em 1 hora.</p>`
    ),
  });
}

/** E-mail avisando o usuário que a conta foi promovida a anunciante pelo admin. Diferente do
 * convite de assistente/procuração: a conta já existe e já tem senha, então é só um aviso com
 * link direto pro painel, sem token de redefinição de senha. */
export async function sendAdvertiserPromotionEmail(params: {
  to: string;
  name: string;
  promotedByName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/anunciante`;
  await sendMail({
    to: params.to,
    subject: `Sua conta agora é de anunciante — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p><strong>${params.promotedByName}</strong> promoveu sua conta para o papel de <strong>Anunciante</strong> no ${appName}.</p>
       <p>Use seu login e senha de sempre para acessar o painel de anunciante:</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Acessar painel do anunciante</a></p>`
    ),
  });
}

/** E-mail pro admin avisando de uma nova solicitação de conta de anunciante aguardando aprovação. */
export async function sendAdvertiserRequestPendingEmail(params: {
  to: string;
  companyName: string;
  planName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const values = {
    nome_plataforma: appName,
    empresa_anunciante: params.companyName,
    nome_plano: params.planName,
    link_solicitacoes_pendentes: `${baseUrl}/admin/anunciantes/solicitacoes`,
  };
  const template = await getEffectiveTemplate("ADVERTISER_REQUEST_PENDING", "EMAIL", "ADMIN");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}

/** E-mail pro anunciante avisando que a solicitação de conta foi aprovada. */
export async function sendAdvertiserRequestApprovedEmail(params: {
  to: string;
  name: string;
  planName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/anunciante`;
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante foi aprovada — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua solicitação de conta de anunciante (plano <strong>${params.planName}</strong>) foi
          <strong>aprovada</strong>! Sua conta já está liberada como anunciante.</p>
       <p>Use seu login e senha de sempre para acessar o painel de anunciante:</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Acessar painel do anunciante</a></p>`
    ),
  });
}

/** E-mail pro anunciante avisando que a solicitação de conta foi rejeitada (com estorno). */
export async function sendAdvertiserRequestRejectedEmail(params: {
  to: string;
  name: string;
  reason: string;
  refunded: boolean;
}): Promise<void> {
  const appName = await getAppName();
  const refundParagraph = params.refunded
    ? `<p>O valor pago já foi estornado automaticamente e deve aparecer no seu extrato em alguns
          dias úteis, conforme o meio de pagamento utilizado.</p>`
    : `<p>Caso tenha sido efetuado algum pagamento, nossa equipe cuidará do estorno e entrará em
          contato caso haja qualquer dúvida.</p>`;
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante não foi aprovada — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua solicitação de conta de anunciante não foi aprovada.</p>
       <p><strong>Motivo:</strong> ${params.reason}</p>
       ${refundParagraph}`
    ),
  });
}

/** E-mail com o resumo diário de atividade (admin ou organizador). */
export async function sendDailySummaryEmail(params: {
  to: string;
  role: "ADMIN" | "ORGANIZER";
  dateLabel: string;
  rows: { label: string; value: string }[];
}): Promise<void> {
  const appName = await getAppName();
  const roleLabel = params.role === "ADMIN" ? "administrador" : "organizador";
  const tableRows = params.rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px">${r.label}</td><td style="padding:4px 8px;font-weight:bold">${r.value}</td></tr>`,
    )
    .join("");
  await sendMail({
    to: params.to,
    subject: `Resumo diário — ${params.dateLabel}`,
    html: layout(
      appName,
      `<p>Olá,</p>
       <p>Este é o resumo de atividade do dia <strong>${params.dateLabel}</strong> (visão de ${roleLabel}):</p>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <tbody>${tableRows}</tbody>
       </table>`,
    ),
  });
}
