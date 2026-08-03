import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, versionId } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const versions = await db.messageTemplateVersion.findMany({ where: { templateId: id } });
  const target = versions.find((v: { id: string }) => v.id === versionId);
  if (!target) return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });

  await db.messageTemplateVersion.create({
    data: { templateId: id, subject: template.subject, body: template.body, active: template.active, changedByUserId: session.user.id },
  });

  const updated = await db.messageTemplate.update({
    where: { id },
    data: { subject: target.subject, body: target.body, active: target.active, updatedByUserId: session.user.id },
  });

  return NextResponse.json({ template: updated });
}
