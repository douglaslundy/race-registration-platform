import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const scheduleSchema = z.object({ scheduledAt: z.string().datetime().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json({ error: "Só é possível agendar/disparar campanhas em rascunho" }, { status: 400 });
  }

  const recipientCount = await db.campaignRecipient.count({ where: { campaignId } });
  if (recipientCount === 0) {
    return NextResponse.json({ error: "Prepare os destinatários antes de agendar ou disparar" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.scheduledAt) {
    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "A data de agendamento precisa ser no futuro" }, { status: 400 });
    }
    const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED", scheduledAt } });
    return NextResponse.json({ campaign: updated });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING", scheduledAt: null } });
  return NextResponse.json({ campaign: updated });
}
