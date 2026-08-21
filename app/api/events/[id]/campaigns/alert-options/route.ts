import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { ALERT_REGISTRY } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

function pickRecipientRole(recipientRoles: string[]): "ATHLETE" | "BUYER" | null {
  if (recipientRoles.includes("ATHLETE")) return "ATHLETE";
  if (recipientRoles.includes("BUYER")) return "BUYER";
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  const options: { alertKey: string; description: string; body: string }[] = [];
  for (const def of Object.values(ALERT_REGISTRY)) {
    if (!def.channels.includes("WHATSAPP")) continue;
    const role = pickRecipientRole(def.recipientRoles);
    if (!role) continue;
    const effective = await getEffectiveTemplate(def.alertKey, "WHATSAPP", role, id);
    options.push({ alertKey: def.alertKey, description: def.description, body: effective.body });
  }

  return NextResponse.json({ options });
}
