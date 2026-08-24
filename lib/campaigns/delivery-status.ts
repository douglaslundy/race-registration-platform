import { db } from "@/lib/db";

const STATUS_RANK: Record<string, number> = { SENT: 0, DELIVERED: 1, READ: 2 };

/** Atualiza o status de um destinatário de campanha a partir do ACK recebido via webhook da
 * Evolution API. Mesma lógica de updateMessageLogStatusByProviderMessageId (lib/message-logs.ts):
 * nunca regride, e permite pular direto de SENT pra READ (o ACK de DELIVERED às vezes não chega).
 * Só considera um destinatário cujo status atual já seja SENT/DELIVERED/READ — qualquer outro
 * status (PENDING, PROCESSING, FAILED, OPTED_OUT, CANCELLED, etc.) é ignorado, porque só participa
 * desse fluxo quem já teve uma mensagem realmente enviada. */
export async function updateCampaignRecipientStatusByProviderMessageId(
  providerMessageId: string,
  status: "DELIVERED" | "READ",
): Promise<void> {
  const existing = await db.campaignRecipient.findFirst({ where: { providerMessageId } });
  if (!existing) return;

  const currentRank = STATUS_RANK[existing.status];
  if (currentRank === undefined || STATUS_RANK[status] <= currentRank) return;

  await db.campaignRecipient.update({
    where: { id: existing.id },
    data: { status },
  });
}
