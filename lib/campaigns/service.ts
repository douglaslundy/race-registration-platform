import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { resolveActingScope, type AssistantScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";
import type { Campaign, Event } from "@prisma/client";

type ListContextResult =
  | { ok: true; scope: AssistantScope; event: Event | null }
  | { ok: false; response: NextResponse };

type DetailContextResult =
  | { ok: true; scope: AssistantScope; event: Event | null; campaign: Campaign }
  | { ok: false; response: NextResponse };

/** Resolve o contexto comum de toda rota de campanha: escopo efetivo (admin/organizador/
 * assistente via resolveActingScope), gate de acesso, e o lookup do evento quando a campanha é de
 * um evento específico (eventId não-nulo). Passe `eventId: null` pras rotas admin-only de
 * plataforma (`/api/admin/campaigns/*`) — nesse caso exige `scope.actingAsAdmin` diretamente, sem
 * checar `hasCampaignsAccess` (que não se aplica a uma capacidade que só admin tem). Centraliza o
 * preâmbulo que se repetia em 6 handlers de 4 arquivos na Fase A — a revisão final daquela fase
 * recomendou extrair antes desta, já que o mesmo padrão de código duplicado foi a causa raiz de
 * um bug real em outra feature deste projeto (social-links esqueceu o branch actingAsAdmin numa
 * rota). */
export async function resolveCampaignListContext(params: {
  session: Session;
  eventId: string | null;
}): Promise<ListContextResult> {
  const scope = await resolveActingScope(params.session);

  if (params.eventId === null) {
    if (!scope.actingAsAdmin) {
      return { ok: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
    }
    return { ok: true, scope, event: null };
  }

  if (!(await hasCampaignsAccess(scope))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
        { status: 403 },
      ),
    };
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: params.eventId } })
    : await db.event.findFirst({ where: { id: params.eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) {
    return { ok: false, response: NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }) };
  }

  return { ok: true, scope, event };
}

/** Como resolveCampaignListContext, mas também busca a campanha (escopada por `eventId` —
 * inclusive quando `null`, o que impede uma campanha de plataforma vazar por uma rota de evento
 * específico e vice-versa) e garante que ela exista, retornando 404 caso contrário. */
export async function resolveCampaignDetailContext(params: {
  session: Session;
  eventId: string | null;
  campaignId: string;
}): Promise<DetailContextResult> {
  const listContext = await resolveCampaignListContext({ session: params.session, eventId: params.eventId });
  if (!listContext.ok) return listContext;

  const campaign = await db.campaign.findFirst({
    where: { id: params.campaignId, eventId: params.eventId },
  });
  if (!campaign) {
    return { ok: false, response: NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 }) };
  }

  return { ok: true, scope: listContext.scope, event: listContext.event, campaign };
}
