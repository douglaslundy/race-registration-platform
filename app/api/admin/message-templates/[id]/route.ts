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
  rowTemplate: z.string().optional(),
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
  const { subject, body, rowTemplate, active } = parsed.data;
  // Um rowTemplate vazio nunca deve ser gravado como "": o resolve.ts trata null/"" como "sem
  // customização" e cai pro texto de fábrica, mas gravar "" persistiria uma lista de linhas vazia.
  // `undefined` (campo não enviado) continua significando "não mexe nessa coluna".
  const normalizedRowTemplate =
    rowTemplate === undefined ? undefined : rowTemplate.trim() ? rowTemplate : null;

  const def = getAlertDefinition(existing.alertKey);
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

  await db.messageTemplateVersion.create({
    data: {
      templateId: id,
      subject: existing.subject,
      body: existing.body,
      rowTemplate: existing.rowTemplate,
      active: existing.active,
      changedByUserId: session.user.id,
    },
  });

  const template = await db.messageTemplate.update({
    where: { id },
    data: { subject, body, rowTemplate: normalizedRowTemplate, active, updatedByUserId: session.user.id },
  });

  return NextResponse.json({ template });
}
