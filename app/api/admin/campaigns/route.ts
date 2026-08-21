import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
import { db } from "@/lib/db";
import { z } from "zod";

const campaignSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  messageBody: z.string().trim().min(1),
});

export async function GET(_req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const campaigns = await db.campaign.findMany({ where: { eventId: null }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(null));
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
  }

  const campaign = await db.campaign.create({
    data: { eventId: null, createdByUserId: session.user.id, ...parsed.data },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_CREATED",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { eventId: null, name: campaign.name },
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
