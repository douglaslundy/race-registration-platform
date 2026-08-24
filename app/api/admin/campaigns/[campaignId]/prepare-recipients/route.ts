import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
import { db } from "@/lib/db";
import { z } from "zod";

const bodySchema = z.object({ athleteUserIds: z.array(z.string()).optional() });

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

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Só é possível preparar destinatários de campanhas em rascunho" },
      { status: 400 },
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success && rawBody && typeof rawBody === "object" && "athleteUserIds" in rawBody) {
    return NextResponse.json({ error: "athleteUserIds deve ser uma lista de IDs" }, { status: 400 });
  }
  const athleteUserIds = parsed.success ? parsed.data.athleteUserIds : undefined;

  const summary = await prepareCampaignRecipients(campaignId, null, athleteUserIds);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RECIPIENTS_PREPARED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: summary,
    },
  });

  return NextResponse.json({ summary });
}
