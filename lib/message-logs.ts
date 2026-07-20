import type { Session } from "next-auth";
import { db } from "./db";

export type MessageChannel = "EMAIL" | "WHATSAPP";
export type MessageLogStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

const STATUS_RANK: Record<MessageLogStatus, number> = { SENT: 0, FAILED: 0, DELIVERED: 1, READ: 2 };

export interface RecordMessageLogParams {
  channel: MessageChannel;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "FAILED";
  errorMessage?: string;
  providerMessageId?: string;
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
        subject: params.subject,
        recipientAddress: params.recipientAddress,
        recipientUserId,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        providerMessageId: params.providerMessageId ?? null,
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
  recipientUserId?: string;
  status?: MessageLogStatus;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listMessageLogs(filters: MessageLogFilters = {}) {
  const { channel, recipientUserId, status, q, from, to, page = 1, pageSize = 20 } = filters;

  const where = {
    ...(channel ? { channel } : {}),
    ...(recipientUserId ? { recipientUserId } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { recipientAddress: { contains: q, mode: "insensitive" as const } },
            { recipientUser: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

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
