import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAlertDefinition } from "@/lib/templates/registry";
import { validateTemplateVariables } from "@/lib/templates/render";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const versions = await db.messageTemplateVersion.findMany({
    where: { templateId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ template, versions });
}

const putSchema = z.object({
  subject: z.string().max(998).optional(),
  body: z.string().min(1),
  active: z.boolean(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const existing = await db.messageTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { subject, body, active } = parsed.data;

  const def = getAlertDefinition(existing.alertKey);
  const allowedVariables = def?.variables ?? [];
  const { valid, unknown } = validateTemplateVariables(`${subject ?? ""} ${body}`, allowedVariables);
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida no template", unknownVariables: unknown }, { status: 400 });
  }

  await db.messageTemplateVersion.create({
    data: {
      templateId: id,
      subject: existing.subject,
      body: existing.body,
      active: existing.active,
      changedByUserId: session.user.id,
    },
  });

  const template = await db.messageTemplate.update({
    where: { id },
    data: { subject, body, active, updatedByUserId: session.user.id },
  });

  return NextResponse.json({ template });
}
