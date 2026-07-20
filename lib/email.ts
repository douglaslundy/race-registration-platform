import nodemailer from "nodemailer";
import { getSmtpConfig, isSmtpReady, type SmtpConfig } from "./smtp-settings";
import { getAppName } from "./settings";
import { recordMessageLog } from "./message-logs";

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
}): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) {
    throw new Error("SMTP não configurado. Configure em Admin → Configurações.");
  }
  const transporter = buildTransport(cfg);

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
    });
    throw err;
  }

  await recordMessageLog({
    channel: "EMAIL",
    subject: opts.subject,
    recipientAddress: opts.to,
    status: "SENT",
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
  await sendMail({
    to: params.to,
    subject: `Vagas se esgotando — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.organizerName},</p>
       <p>O lote <strong>${params.batchName}</strong> do evento <strong>${params.eventTitle}</strong> já vendeu
       <strong>${params.soldCount} de ${params.capacity}</strong> vagas (${percent}%).</p>
       <p>Considere abrir um novo lote em breve.</p>`
    ),
  });
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
  const url = `${baseUrl}/dashboard/inscricoes`;
  await sendMail({
    to: params.to,
    subject: `Finalize sua inscrição — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Notamos que você iniciou uma inscrição em <strong>${params.eventTitle}</strong> mas o pagamento ainda não foi concluído.</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Finalizar pagamento</a></p>`
    ),
  });
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
