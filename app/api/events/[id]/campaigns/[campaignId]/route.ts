import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope, type AssistantScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    messageBody: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo para atualizar" });

async function loadEventAndCampaign(scope: AssistantScope, eventId: string, campaignId: string) {
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return { event: null, campaign: null };

  const campaign = await db.campaign.findFirst({ where: { id: campaignId, eventId } });
  return { event, campaign };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const { event, campaign } = await loadEventAndCampaign(scope, id, campaignId);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  return NextResponse.json({ campaign });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const { event, campaign } = await loadEventAndCampaign(scope, id, campaignId);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (campaign.status !== "DRAFT") {
    return NextResponse.json({ error: "Só é possível editar campanhas em rascunho" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await db.campaign.update({ where: { id: campaignId }, data: parsed.data });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_UPDATED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ campaign: updated });
}
