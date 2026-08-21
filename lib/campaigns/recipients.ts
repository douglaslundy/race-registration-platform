import { db } from "@/lib/db";
import { normalizePhoneForWhatsApp, isValidWhatsAppPhone } from "@/lib/whatsapp";

export interface PrepareRecipientsResult {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
}

const BATCH_SIZE = 500;

interface CandidateRow {
  athleteUserId: string;
  registrationId: string | null;
  receivePromotionalMessages: boolean;
  phone: string | null;
}

async function fetchCandidateBatch(
  eventId: string | null,
  skip: number,
): Promise<CandidateRow[]> {
  if (eventId !== null) {
    const registrations = await db.registration.findMany({
      where: { eventId },
      select: {
        id: true,
        athleteUserId: true,
        athlete: {
          select: {
            receivePromotionalMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    return registrations.map((r) => ({
      athleteUserId: r.athleteUserId,
      registrationId: r.id,
      receivePromotionalMessages: r.athlete.receivePromotionalMessages,
      phone: r.athlete.athleteProfile?.phone ?? null,
    }));
  }

  const users = await db.user.findMany({
    where: { role: "ATHLETE", active: true },
    select: {
      id: true,
      receivePromotionalMessages: true,
      athleteProfile: { select: { phone: true } },
    },
    skip,
    take: BATCH_SIZE,
    orderBy: { id: "asc" },
  });

  return users.map((u) => ({
    athleteUserId: u.id,
    registrationId: null,
    receivePromotionalMessages: u.receivePromotionalMessages,
    phone: u.athleteProfile?.phone ?? null,
  }));
}

/** Repopula os destinatários de uma campanha: apaga os existentes e busca candidatos de novo — do
 * evento (qualquer status de inscrição), se `eventId` não for nulo, ou de toda a base de atletas
 * ativos, se for — em lotes, sem carregar tudo em memória de uma vez. Aplica, nesta ordem, o
 * filtro de receivePromotionalMessages (sempre, nunca opcional), validação/normalização de
 * telefone, e deduplicação por telefone dentro da campanha (a 1ª ocorrência permanece PENDING, as
 * demais viram SKIPPED). Idempotente — pode ser chamada de novo a qualquer momento; a rota que
 * chama garante que a campanha ainda está em DRAFT, esta função não checa `status` de novo. */
export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
): Promise<PrepareRecipientsResult> {
  await db.campaignRecipient.deleteMany({ where: { campaignId } });

  const result: PrepareRecipientsResult = { total: 0, pending: 0, optedOut: 0, invalidPhone: 0, duplicate: 0 };
  const seenPhones = new Set<string>();
  let skip = 0;

  while (true) {
    const candidates = await fetchCandidateBatch(eventId, skip);
    if (candidates.length === 0) break;
    skip += candidates.length;

    const rows = candidates.map((candidate) => {
      result.total += 1;
      const normalized = candidate.phone ? normalizePhoneForWhatsApp(candidate.phone) : "";

      if (!candidate.receivePromotionalMessages) {
        result.optedOut += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "OPTED_OUT" as const,
        };
      }

      if (!candidate.phone || !isValidWhatsAppPhone(normalized)) {
        result.invalidPhone += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "INVALID_PHONE" as const,
        };
      }

      if (seenPhones.has(normalized)) {
        result.duplicate += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "SKIPPED" as const,
          failureReason: "Telefone duplicado nesta campanha",
        };
      }

      seenPhones.add(normalized);
      result.pending += 1;
      return {
        campaignId,
        athleteUserId: candidate.athleteUserId,
        registrationId: candidate.registrationId,
        normalizedPhone: normalized,
        status: "PENDING" as const,
      };
    });

    await db.campaignRecipient.createMany({ data: rows });

    if (candidates.length < BATCH_SIZE) break;
  }

  return result;
}
