import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const { id, campaignId } = await params;
  const check = await checkApiPermission("campaigns.cancel", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT" && context.campaign.status !== "SCHEDULED") {
    return NextResponse.json(
      { error: "Só é possível cancelar campanhas em rascunho ou agendadas" },
      { status: 400 },
    );
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "CANCELLED" } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_CANCELLED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ campaign: updated });
}
