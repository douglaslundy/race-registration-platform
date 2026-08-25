import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

const MAX_ROWS = 200;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const rows = await db.campaignRecipient.findMany({
    where: { campaignId, status: "FAILED" },
    select: { normalizedPhone: true, failureReason: true, attempts: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_ROWS,
  });

  return NextResponse.json({ rows });
}
