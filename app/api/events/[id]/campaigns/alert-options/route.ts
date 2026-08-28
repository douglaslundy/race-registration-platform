import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { ALERT_REGISTRY } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import { validateTemplateVariables } from "@/lib/templates/render";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";

function pickRecipientRole(recipientRoles: string[]): "ATHLETE" | "BUYER" | null {
  if (recipientRoles.includes("ATHLETE")) return "ATHLETE";
  if (recipientRoles.includes("BUYER")) return "BUYER";
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("campaigns.view", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  const candidates = Object.values(ALERT_REGISTRY).filter((def) => {
    if (!def.channels.includes("WHATSAPP")) return false;
    return pickRecipientRole(def.recipientRoles) !== null;
  });

  const resolved = await Promise.all(
    candidates.map(async (def) => {
      const role = pickRecipientRole(def.recipientRoles)!;
      const effective = await getEffectiveTemplate(def.alertKey, "WHATSAPP", role, id);
      return { alertKey: def.alertKey, description: def.description, body: effective.body };
    }),
  );

  const allowedVariables = getAllowedCampaignVariableNames(id);
  const options = resolved.filter((opt) => validateTemplateVariables(opt.body, allowedVariables).valid);

  return NextResponse.json({ options });
}
