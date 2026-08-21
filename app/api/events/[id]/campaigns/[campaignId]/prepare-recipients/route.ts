import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
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

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Só é possível preparar destinatários de campanhas em rascunho" },
      { status: 400 },
    );
  }

  const summary = await prepareCampaignRecipients(campaignId, id);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RECIPIENTS_PREPARED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: summary as any,
    },
  });

  return NextResponse.json({ summary });
}
