import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariables } from "@/lib/campaigns/variables";

export async function GET(_req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  return NextResponse.json({ variables: getAllowedCampaignVariables(null, true) });
}
