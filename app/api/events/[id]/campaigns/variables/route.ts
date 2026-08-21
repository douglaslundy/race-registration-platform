import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariables } from "@/lib/campaigns/variables";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  return NextResponse.json({ variables: getAllowedCampaignVariables(id) });
}
