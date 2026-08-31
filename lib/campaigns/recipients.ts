import { db } from "@/lib/db";
import { normalizePhoneForWhatsApp, isValidWhatsAppPhone } from "@/lib/whatsapp";

export type PrepareRecipientsResult = {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
};

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
  athleteUserIds?: string[],
  manualEventId?: string,
): Promise<CandidateRow[]> {
  if (eventId !== null) {
    const registrations = await db.registration.findMany({
      where: { eventId, status: "CONFIRMED" },
      select: {
        id: true,
        athleteUserId: true,
        participantPhone: true,
        athlete: {
          select: {
            receivePromotionalMessages: true,
          },
        },
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    // Telefone de envio = snapshot da inscrição (spec §4.7). `participantPhone` null cai
    // naturalmente em INVALID_PHONE mais abaixo — NÃO há fallback pro telefone da conta
    // (consentimento e opt-out são por número; usar o da conta contornaria isso).
    return registrations.map((r) => ({
      athleteUserId: r.athleteUserId,
      registrationId: r.id,
      receivePromotionalMessages: r.athlete.receivePromotionalMessages,
      phone: r.participantPhone ?? null,
    }));
  }

  const users = await db.user.findMany({
    where: {
      role: "ATHLETE",
      active: true,
      ...(athleteUserIds ? { id: { in: athleteUserIds } } : {}),
    },
    select: {
      id: true,
      receivePromotionalMessages: true,
      athleteProfile: { select: { phone: true } },
    },
    skip,
    take: BATCH_SIZE,
    orderBy: { id: "asc" },
  });

  // Seleção manual filtrada por evento: cada destinatário precisa saber a qual inscrição ele se
  // refere pra variáveis de Evento/Inscrição resolverem corretamente (ver
  // messageUsesEventScopedVariables em lib/campaigns/variables.ts). Busca em lote — 1 query pro
  // batch inteiro, não 1 por atleta.
  let registrationByAthlete = new Map<string, { id: string; participantPhone: string | null }>();
  if (manualEventId && users.length > 0) {
    const registrations = await db.registration.findMany({
      where: { eventId: manualEventId, status: "CONFIRMED", athleteUserId: { in: users.map((u) => u.id) } },
      select: { id: true, athleteUserId: true, participantPhone: true },
    });
    registrationByAthlete = new Map(
      registrations.map((r) => [r.athleteUserId, { id: r.id, participantPhone: r.participantPhone }]),
    );
  }

  return users.map((u) => {
    const reg = registrationByAthlete.get(u.id);
    return {
      athleteUserId: u.id,
      registrationId: reg?.id ?? null,
      receivePromotionalMessages: u.receivePromotionalMessages,
      // Casado com uma inscrição do evento (seleção manual filtrada por evento) → telefone do
      // snapshot da inscrição; senão (base de atletas, sem snapshot) → telefone do perfil.
      phone: reg ? reg.participantPhone ?? null : u.athleteProfile?.phone ?? null,
    };
  });
}

/** Repopula os destinatários de uma campanha: apaga os existentes e busca candidatos de novo — do
 * evento (só inscrições CONFIRMED), se `eventId` não for nulo, ou de toda a base de atletas
 * ativos, se for — em lotes, sem carregar tudo em memória de uma vez. Aplica, nesta ordem, o
 * filtro de receivePromotionalMessages (sempre, nunca opcional), validação/normalização de
 * telefone, e deduplicação por telefone dentro da campanha (a 1ª ocorrência permanece PENDING, as
 * demais viram SKIPPED). Idempotente — pode ser chamada de novo a qualquer momento; a rota que
 * chama garante que a campanha ainda está em DRAFT, esta função não checa `status` de novo.
 * Aceita `athleteUserIds` opcional (só usado quando `eventId` é nulo) pra restringir os candidatos
 * a uma lista explícita de atletas — usado pela seleção manual de destinatários. Aceita também
 * `manualEventId` opcional (só junto com `athleteUserIds`) pra vincular cada destinatário
 * selecionado manualmente à sua inscrição CONFIRMED naquele evento específico — sem isso,
 * `registrationId` fica `null` e variáveis de Evento/Inscrição não resolvem pra essa pessoa. */
export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
  athleteUserIds?: string[],
  manualEventId?: string,
): Promise<PrepareRecipientsResult> {
  await db.campaignRecipient.deleteMany({ where: { campaignId } });

  const result: PrepareRecipientsResult = { total: 0, pending: 0, optedOut: 0, invalidPhone: 0, duplicate: 0 };
  const seenPhones = new Set<string>();
  let skip = 0;

  while (true) {
    const candidates = await fetchCandidateBatch(eventId, skip, athleteUserIds, manualEventId);
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
          normalizedPhone: "",
          status: "OPTED_OUT" as const,
          failureReason: null,
        };
      }

      if (!candidate.phone || !isValidWhatsAppPhone(normalized)) {
        result.invalidPhone += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: "",
          status: "INVALID_PHONE" as const,
          failureReason: null,
        };
      }

      if (seenPhones.has(normalized)) {
        result.duplicate += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: "",
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
        failureReason: null,
      };
    });

    await db.campaignRecipient.createMany({ data: rows });

    if (candidates.length < BATCH_SIZE) break;
  }

  return result;
}
