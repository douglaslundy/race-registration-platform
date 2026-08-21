import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { buildPreferencesFooterText } from "@/lib/whatsapp";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  return NextResponse.json({ body });
}
