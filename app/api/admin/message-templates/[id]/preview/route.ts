import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { renderTemplate, renderTemplateSubject } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const channel = template.channel as "EMAIL" | "WHATSAPP";
  return NextResponse.json({
    subject: template.subject ? renderTemplateSubject(template.subject, SAMPLE_VALUES) : undefined,
    body: renderTemplate(template.body, SAMPLE_VALUES, channel),
  });
}
