import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    messageBody: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo para atualizar" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  return NextResponse.json({ campaign: context.campaign });
}

export async function PATCH(
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
    return NextResponse.json({ error: "Só é possível editar campanhas em rascunho" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.messageBody !== undefined) {
    const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(id));
    if (!valid) {
      return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
    }
  }

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  try {
    await db.$transaction(async (tx) => {
      await tx.campaignRecipient.deleteMany({
        where: { campaignId, status: { notIn: ["PROCESSING", "SENT", "DELIVERED", "READ", "FAILED"] } },
      });
      const remaining = await tx.campaignRecipient.count({ where: { campaignId } });
      if (remaining > 0) {
        throw new Error("CAMPAIGN_HAS_SENDS");
      }
      await tx.campaign.delete({ where: { id: campaignId } });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "CAMPAIGN_HAS_SENDS") {
      return NextResponse.json(
        { error: "Não é possível excluir uma campanha que já teve envios reais" },
        { status: 400 },
      );
    }
    throw err;
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DELETED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ ok: true });
}
