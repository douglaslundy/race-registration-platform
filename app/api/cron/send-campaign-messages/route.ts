import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sendWhatsAppMessage,
  buildPreferencesFooterText,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
} from "@/lib/whatsapp";
import { renderTemplate } from "@/lib/templates/render";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";
import {
  recordCampaignSendFailure,
  recordCampaignSendSuccess,
  isCircuitBreakerTripped,
} from "@/lib/campaigns/circuit-breaker";

const MAX_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // 1. Promove campanhas agendadas cujo horário já passou.
  await db.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "RUNNING" },
  });

  // 2. Guarda contra tick sobreposto — não é uma trava distribuída (Fase F cuida disso), só evita
  // duplo-processamento óbvio dentro de UM container.
  const stuck = await db.campaignRecipient.findFirst({ where: { status: "PROCESSING" } });
  if (stuck) {
    return NextResponse.json({ processed: false, reason: "processing_in_progress" });
  }

  // 3. Circuit breaker já disparado — não processa nada.
  if (await isCircuitBreakerTripped()) {
    return NextResponse.json({ processed: false, reason: "circuit_breaker_tripped" });
  }

  // 4. Escolhe o próximo destinatário: campanha RUNNING mais antiga com algo PENDING, dentro dela
  // o CampaignRecipient PENDING mais antigo.
  const recipient = await db.campaignRecipient.findFirst({
    where: { status: "PENDING", campaign: { status: "RUNNING" } },
    orderBy: [{ campaign: { createdAt: "asc" } }, { createdAt: "asc" }],
  });

  if (!recipient) {
    // Nenhum PENDING em nenhuma campanha RUNNING — completa as que não têm mais nada pendente.
    const runningCampaigns = await db.campaign.findMany({ where: { status: "RUNNING" }, select: { id: true } });
    for (const c of runningCampaigns) {
      const remaining = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "PENDING" } });
      if (remaining === 0) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
      }
    }
    return NextResponse.json({ processed: false, reason: "nothing_pending" });
  }

  await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "PROCESSING" } });

  try {
    // A re-checagem de consentimento, a campanha, a resolução de variáveis e a renderização do
    // template vivem dentro do try: qualquer exceção aqui (erro transiente de banco, bug na
    // resolução de variáveis, messageBody malformado) precisa cair na mesma lógica de
    // retry/FAILED/circuit-breaker do catch abaixo — senão o destinatário fica preso em
    // PROCESSING pra sempre e a guarda do passo 2 (linha ~29) trava TODO o envio de campanhas em
    // todo tick futuro, sem log nem alerta.

    // 5. Re-checa consentimento AGORA — uma campanha longa dá tempo de sobra pro atleta mudar de
    // ideia em /preferencias depois que a Fase B já preparou a lista.
    const athlete = await db.user.findUnique({
      where: { id: recipient.athleteUserId },
      select: { receivePromotionalMessages: true, athleteProfile: { select: { phone: true } } },
    });

    if (!athlete?.receivePromotionalMessages) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "OPTED_OUT" } });
      return NextResponse.json({ processed: true, result: "opted_out" });
    }

    // 5b. Usa o telefone ATUAL do atleta (buscado agora), não o snapshot capturado quando a Fase B
    // preparou a lista — pode estar dias desatualizado numa campanha lenta, e enviar pro número
    // errado (reatribuído/corrigido nesse meio-tempo) seria uma mensagem promocional pra quem não
    // consentiu, enquanto quem consentiu de fato nunca recebe.
    const freshPhone = athlete.athleteProfile?.phone
      ? normalizePhoneForWhatsApp(athlete.athleteProfile.phone)
      : null;
    if (!freshPhone || !isValidWhatsAppPhone(freshPhone)) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "INVALID_PHONE" } });
      return NextResponse.json({ processed: true, result: "invalid_phone" });
    }

    const campaign = await db.campaign.findFirst({ where: { id: recipient.campaignId } });
    if (!campaign) {
      throw new Error("Campanha não encontrada");
    }

    const values = await resolveCampaignRecipientVariables({
      athleteUserId: recipient.athleteUserId,
      registrationId: recipient.registrationId,
    });
    const body = renderTemplate(campaign.messageBody, values, "WHATSAPP") + buildPreferencesFooterText();

    let sendResult: { providerMessageId?: string };
    try {
      sendResult = await sendWhatsAppMessage(freshPhone, body, "CAMPAIGN_MESSAGE");
    } catch (sendErr) {
      const { tripped } = await recordCampaignSendFailure();
      if (tripped) {
        await db.campaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED" } });
      }
      throw sendErr;
    }

    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: sendResult.providerMessageId, failureReason: null },
    });
    await recordCampaignSendSuccess();
    return NextResponse.json({ processed: true, result: "sent" });
  } catch (err) {
    const attempts = (recipient.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
        attempts,
        failureReason: err instanceof Error ? err.message : String(err),
      },
    });
    // Nota: recordCampaignSendFailure() já foi chamado acima, dentro do try interno, se o erro
    // veio de sendWhatsAppMessage. Erros de qualquer outra etapa (busca de campanha, resolução de
    // variáveis, renderização, telefone inválido) chegam aqui SEM contar pro circuit breaker
    // global — só uma falha de envio real deve contar, senão blips transitórios de banco
    // pausariam todas as campanhas.
    return NextResponse.json({ processed: true, result: failed ? "failed" : "retry_scheduled" });
  }
}
