import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import {
  sendWhatsAppMessage,
  buildPreferencesFooterText,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
} from "@/lib/whatsapp";
import { db } from "@/lib/db";
import { z } from "zod";

const bodySchema = z.object({ phone: z.string().trim().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.messageBody.includes("{{qrcode_inscricao}}")) {
    return NextResponse.json(
      { error: "Esta variável só funciona no disparo real da campanha (depende de uma inscrição vinculada) — não está disponível no teste ou no envio avulso." },
      { status: 400 },
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 });
  }

  const normalized = normalizePhoneForWhatsApp(parsed.data.phone);
  if (!isValidWhatsAppPhone(normalized)) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  // Um atleta pode ter optado por não receber mensagens promocionais — mesmo este sendo um envio
  // avulso pra um número digitado na hora (sem CampaignRecipient), nunca deveria contornar esse
  // consentimento se o número digitado bater com o telefone de um atleta que já optou por não
  // receber. Phones são guardados sem normalização no banco, então filtramos candidatos pelos
  // últimos 8 dígitos (barato, cobre qualquer formatação) e comparamos a forma normalizada exata.
  const last8 = normalized.slice(-8);
  const candidates = await db.user.findMany({
    where: { role: "ATHLETE", athleteProfile: { phone: { contains: last8 } } },
    select: { receivePromotionalMessages: true, athleteProfile: { select: { phone: true } } },
  });
  const optedOutMatch = candidates.some(
    (u) =>
      !u.receivePromotionalMessages &&
      u.athleteProfile?.phone &&
      normalizePhoneForWhatsApp(u.athleteProfile.phone) === normalized,
  );
  if (optedOutMatch) {
    return NextResponse.json(
      { error: "Este número pertence a um atleta que optou por não receber mensagens promocionais" },
      { status: 400 },
    );
  }

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  await sendWhatsAppMessage(normalized, body, "CAMPAIGN_MESSAGE");

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_SENT_TO_NUMBER",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: { phone: normalized },
    },
  });

  return NextResponse.json({ ok: true });
}
