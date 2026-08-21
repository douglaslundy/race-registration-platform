import type { Session } from "next-auth";
import { db } from "./db";

export type MessageChannel = "EMAIL" | "WHATSAPP";
export type MessageLogStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

const STATUS_RANK: Record<MessageLogStatus, number> = { SENT: 0, FAILED: 0, DELIVERED: 1, READ: 2 };

export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  LOW_STOCK: "Vagas se esgotando",
  ABANDONED_CART: "Carrinho abandonado",
  PAYMENT_ERROR: "Erro de pagamento",
  PAYMENT_ERROR_ORDER_CANCELLED: "Erro de pagamento (pedido cancelado)",
  RECONCILIATION_MISMATCH: "Divergência de conciliação",
  CANCELLATION_REQUESTED: "Solicitação de cancelamento",
  DAILY_SUMMARY: "Resumo diário",
  DAILY_SUMMARY_EVENT: "Resumo diário do evento",
  ADVERTISER_REQUEST_PENDING: "Solicitação de anunciante pendente",
  ORDER_CONFIRMED: "Confirmação de inscrição",
  ORDER_CONFIRMED_PROXY_BUYER: "Confirmação de inscrição (procuração — comprador)",
  ORDER_CONFIRMED_PROXY_ATHLETE: "Confirmação de inscrição (procuração — atleta)",
  PASSWORD_RESET: "Redefinição de senha",
  ASSISTANT_INVITE: "Convite de assistente",
  PROXY_REGISTRATION_INVITE: "Convite de inscrição por procuração",
  AD_PURCHASE_CONFIRMATION: "Confirmação de compra de anúncio",
  ADVERTISER_PROMOTION: "Promoção a anunciante",
  ADVERTISER_REQUEST_APPROVED: "Solicitação de anunciante aprovada",
  ADVERTISER_REQUEST_REJECTED: "Solicitação de anunciante rejeitada",
  AD_REPORT: "Relatório de anúncio",
  WHATSAPP_CONNECTION_TEST: "Teste de conexão do WhatsApp",
  SENSITIVE_ACTION_CODE: "Código de verificação",
  CAMPAIGN_TEST: "Teste de campanha de WhatsApp",
};

export interface RecordMessageLogParams {
  channel: MessageChannel;
  messageType?: string;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "FAILED";
  errorMessage?: string;
  providerMessageId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

async function resolveRecipientUserIdByEmail(email: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email } });
  return user?.id ?? null;
}

async function resolveRecipientUserIdByPhone(phone: string): Promise<string | null> {
  const user = await db.user.findFirst({ where: { phone } });
  return user?.id ?? null;
}

/** Registra o resultado de um envio de e-mail/WhatsApp. Nunca lança — é best-effort, não pode
 * derrubar um envio que já aconteceu (ou já falhou por outro motivo real). */
export async function recordMessageLog(params: RecordMessageLogParams): Promise<void> {
  try {
    const recipientUserId =
      params.channel === "EMAIL"
        ? await resolveRecipientUserIdByEmail(params.recipientAddress)
        : await resolveRecipientUserIdByPhone(params.recipientAddress);

    await db.messageLog.create({
      data: {
        channel: params.channel,
        messageType: params.messageType ?? null,
        subject: params.subject,
        recipientAddress: params.recipientAddress,
        recipientUserId,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        providerMessageId: params.providerMessageId ?? null,
        relatedEntityType: params.relatedEntityType ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
        sentAt: params.status === "SENT" ? new Date() : null,
      },
    });
  } catch {
    // Best-effort — gravação do log nunca deve mascarar nem quebrar o fluxo de envio real.
  }
}

/** Atualiza o status de uma mensagem de WhatsApp a partir do ACK recebido via webhook. Nunca
 * regride (READ não volta pra DELIVERED). */
export async function updateMessageLogStatusByProviderMessageId(
  providerMessageId: string,
  status: "DELIVERED" | "READ",
): Promise<void> {
  const existing = await db.messageLog.findFirst({ where: { providerMessageId } });
  if (!existing) return;
  if (STATUS_RANK[status] <= STATUS_RANK[existing.status as MessageLogStatus]) return;

  await db.messageLog.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(status === "READ" ? { readAt: new Date() } : {}),
    },
  });
}

export interface MessageLogFilters {
  channel?: MessageChannel;
  messageType?: string;
  recipientUserId?: string;
  /** IDs de eventos do organizador — ORed com recipientUserId, para incluir mensagens enviadas
   * aos atletas inscritos nesses eventos (não só mensagens endereçadas ao próprio organizador). */
  eventIds?: string[];
  status?: MessageLogStatus;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listMessageLogs(filters: MessageLogFilters = {}) {
  const { channel, messageType, recipientUserId, eventIds, status, q, from, to, page = 1, pageSize = 20 } = filters;

  const scopeClause: Record<string, unknown> | null = recipientUserId
    ? eventIds && eventIds.length > 0
      ? { OR: [{ recipientUserId }, { relatedEntityType: "Event", relatedEntityId: { in: eventIds } }] }
      : { recipientUserId }
    : null;

  const searchClause: Record<string, unknown> | null = q
    ? {
        OR: [
          { recipientAddress: { contains: q, mode: "insensitive" as const } },
          { recipientUser: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : null;

  const baseWhere = {
    ...(channel ? { channel } : {}),
    ...(messageType ? { messageType } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  // scopeClause e searchClause podem gerar cada um sua própria chave `OR` — combinadas via spread
  // direto, a segunda sobrescreveria a primeira (perdendo o escopo de segurança do organizador).
  // Só nesse caso as duas viram cláusulas de um `AND` explícito.
  const where =
    scopeClause && searchClause
      ? { ...baseWhere, AND: [scopeClause, searchClause] }
      : { ...baseWhere, ...(scopeClause ?? {}), ...(searchClause ?? {}) };

  const [rows, total] = await Promise.all([
    db.messageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { recipientUser: { select: { name: true } } },
    }),
    db.messageLog.count({ where }),
  ]);

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Resolve de quem são as mensagens que a tela do organizador deve mostrar: o próprio organizador,
 * ou (se for um assistente) o organizador que o criou. Qualquer outro papel retorna null — o
 * chamador deve tratar null como "nenhum escopo válido" (nunca cair pra "mostrar tudo"). */
export async function resolveMessageOwnerUserId(session: Session): Promise<string | null> {
  if (session.user.role === "ORGANIZER") return session.user.id;
  if (session.user.role === "ASSISTANT") {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    return user?.createdByUserId ?? null;
  }
  return null;
}

/** IDs dos eventos de um organizador — usado para ampliar o escopo da caixa de mensagens do
 * organizador às mensagens enviadas aos atletas inscritos nesses eventos, além das endereçadas a
 * ele mesmo. `organizerUserId` é sempre o dono real (já resolvido via `resolveMessageOwnerUserId`
 * no caso de assistente), nunca o id de sessão bruto. */
export async function resolveOrganizerEventIds(organizerUserId: string): Promise<string[]> {
  const events = await db.event.findMany({
    where: { organizerId: organizerUserId },
    select: { id: true },
  });
  return events.map((e) => e.id);
}
