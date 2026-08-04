import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAlertDefinition } from "@/lib/templates/registry";
import { validateTemplateVariables } from "@/lib/templates/render";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

async function findEventOverride(globalTemplate: { alertKey: string; channel: string; recipientRole: string }, eventId: string) {
  return db.messageTemplate.findFirst({
    where: {
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      scope: "EVENT",
      eventId,
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const eventRow = await findEventOverride(globalTemplate, eventId);
  if (eventRow) {
    const versions = await db.messageTemplateVersion.findMany({ where: { templateId: eventRow.id }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ template: eventRow, versions, isOverride: true });
  }

  const effective = await getEffectiveTemplate(
    globalTemplate.alertKey,
    globalTemplate.channel as "EMAIL" | "WHATSAPP",
    globalTemplate.recipientRole,
    eventId,
  );
  return NextResponse.json({
    template: {
      id: null,
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      subject: effective.subject ?? null,
      body: effective.body,
      rowTemplate: effective.rowTemplate ?? null,
      active: true,
    },
    versions: [],
    isOverride: false,
  });
}

const putSchema = z.object({
  subject: z.string().max(998).optional(),
  body: z.string().min(1),
  rowTemplate: z.string().optional(),
  active: z.boolean(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { subject, body, rowTemplate, active } = parsed.data;

  const def = getAlertDefinition(globalTemplate.alertKey);
  const { valid, unknown } = validateTemplateVariables(`${subject ?? ""} ${body}`, def?.variables ?? []);
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida no template", unknownVariables: unknown }, { status: 400 });
  }
  if (def?.rowVariables) {
    const rowCheck = validateTemplateVariables(rowTemplate ?? "", def.rowVariables);
    if (!rowCheck.valid) {
      return NextResponse.json({ error: "Variável desconhecida no template de cada linha", unknownVariables: rowCheck.unknown }, { status: 400 });
    }
  }

  const existing = await findEventOverride(globalTemplate, eventId);

  let eventRow;
  if (existing) {
    await db.messageTemplateVersion.create({
      data: { templateId: existing.id, subject: existing.subject, body: existing.body, rowTemplate: existing.rowTemplate, active: existing.active, changedByUserId: session.user.id },
    });
    eventRow = await db.messageTemplate.update({
      where: { id: existing.id },
      data: { subject, body, rowTemplate, active, updatedByUserId: session.user.id },
    });
  } else {
    eventRow = await db.messageTemplate.create({
      data: {
        alertKey: globalTemplate.alertKey,
        channel: globalTemplate.channel,
        recipientRole: globalTemplate.recipientRole,
        scope: "EVENT",
        eventId,
        subject,
        body,
        rowTemplate,
        active,
        updatedByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json({ template: eventRow, isOverride: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const eventRow = await findEventOverride(globalTemplate, eventId);
  if (!eventRow) return NextResponse.json({ error: "Personalização não encontrada" }, { status: 404 });

  // Apaga de vez (não marca active: false) — decisão fechada na spec: uma personalização por
  // evento desativada não tem valor (diferente do GLOBAL, que sempre existe como registro único).
  await db.messageTemplate.delete({ where: { id: eventRow.id } });
  return NextResponse.json({ success: true });
}
