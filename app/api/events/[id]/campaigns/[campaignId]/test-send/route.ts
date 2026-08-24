import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { sendWhatsAppMessage, buildPreferencesFooterText } from "@/lib/whatsapp";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.messageBody.includes("{{qrcode_inscricao}}")) {
    return NextResponse.json(
      { error: "Esta variável só funciona no disparo real da campanha (depende de uma inscrição vinculada) — não está disponível no teste ou no envio avulso." },
      { status: 400 },
    );
  }

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
  if (!user?.phone) {
    return NextResponse.json({ error: "Sua conta não tem telefone cadastrado" }, { status: 400 });
  }

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  await sendWhatsAppMessage(user.phone, `[TESTE] ${body}`, "CAMPAIGN_TEST");

  return NextResponse.json({ ok: true });
}
