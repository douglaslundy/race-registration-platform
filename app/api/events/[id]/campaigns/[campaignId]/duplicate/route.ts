import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.create");
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

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const original = await db.campaign.findFirst({ where: { id: campaignId, eventId: id } });
  if (!original) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const duplicate = await db.campaign.create({
    data: {
      eventId: id,
      createdByUserId: session.user.id,
      name: `Cópia de ${original.name}`,
      description: original.description,
      messageBody: original.messageBody,
      status: "DRAFT",
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DUPLICATED",
      entityType: "Campaign",
      entityId: duplicate.id,
      metadata: { originalCampaignId: campaignId },
    },
  });

  return NextResponse.json({ campaign: duplicate }, { status: 201 });
}
