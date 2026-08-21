import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const duplicate = await db.campaign.create({
    data: {
      eventId: null,
      createdByUserId: session.user.id,
      name: `Cópia de ${context.campaign.name}`,
      description: context.campaign.description,
      messageBody: context.campaign.messageBody,
      status: "DRAFT",
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DUPLICATED",
      entityType: "Campaign",
      entityId: duplicate.id,
      metadata: { originalCampaignId: campaignId },
    },
  });

  return NextResponse.json({ campaign: duplicate }, { status: 201 });
}
