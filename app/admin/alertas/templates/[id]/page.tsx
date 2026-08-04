import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getVariablesByNames } from "@/lib/templates/variables";
import { getAlertDefinition, type AlertChannel } from "@/lib/templates/registry";
import MessageTemplateEditor from "@/components/admin/MessageTemplateEditor";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editar template — Admin" };

export default async function EditMessageTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) notFound();

  const versions = await db.messageTemplateVersion.findMany({
    where: { templateId: id },
    orderBy: { createdAt: "desc" },
  });
  const def = getAlertDefinition(template.alertKey);
  const variables = getVariablesByNames(def?.variables ?? []);
  const rowVariables = def?.rowVariables ? getVariablesByNames(def.rowVariables) : undefined;

  // Template de linha EFETIVO (o que realmente é usado no envio): se a coluna estiver vazia/null,
  // o resolve.ts cai pro texto de fábrica — o editor precisa refletir isso, senão o admin salva um
  // textarea vazio por cima do conteúdo que estava valendo. `||` cobre null E string vazia.
  const effectiveRowTemplate =
    template.rowTemplate || def?.rowTemplate?.(template.channel as AlertChannel) || null;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">{def?.description ?? template.alertKey}</h1>
      <MessageTemplateEditor
        templateId={template.id}
        saveUrl={`/api/admin/message-templates/${template.id}`}
        initialSubject={template.subject}
        initialBody={template.body}
        initialRowTemplate={effectiveRowTemplate}
        initialActive={template.active}
        channel={template.channel as "EMAIL" | "WHATSAPP"}
        variables={variables}
        rowVariables={rowVariables}
        versions={versions.map((v) => ({
          id: v.id,
          subject: v.subject,
          body: v.body,
          active: v.active,
          createdAt: v.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
