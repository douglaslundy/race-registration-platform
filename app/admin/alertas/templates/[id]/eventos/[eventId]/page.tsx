import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getVariablesByNames } from "@/lib/templates/variables";
import { getAlertDefinition } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import MessageTemplateEditor from "@/components/admin/MessageTemplateEditor";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Personalizar template por evento — Admin" };

export default async function EditEventMessageTemplatePage({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  await requireAdmin();
  const { id, eventId } = await params;

  const [globalTemplate, event] = await Promise.all([
    db.messageTemplate.findUnique({ where: { id } }),
    db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } }),
  ]);
  if (!globalTemplate || !event) notFound();

  const eventRow = await db.messageTemplate.findFirst({
    where: {
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      scope: "EVENT",
      eventId,
    },
  });

  const def = getAlertDefinition(globalTemplate.alertKey);
  const variables = getVariablesByNames(def?.variables ?? []);
  const rowVariables = def?.rowVariables ? getVariablesByNames(def.rowVariables) : undefined;

  let initialSubject: string | null;
  let initialBody: string;
  let initialRowTemplate: string | null;
  let initialActive: boolean;
  const isOverride = !!eventRow;

  if (eventRow) {
    initialSubject = eventRow.subject;
    initialBody = eventRow.body;
    initialRowTemplate = eventRow.rowTemplate;
    initialActive = eventRow.active;
  } else {
    const effective = await getEffectiveTemplate(
      globalTemplate.alertKey,
      globalTemplate.channel as "EMAIL" | "WHATSAPP",
      globalTemplate.recipientRole,
      eventId,
    );
    initialSubject = effective.subject ?? null;
    initialBody = effective.body;
    initialRowTemplate = effective.rowTemplate ?? null;
    initialActive = true;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">{def?.description ?? globalTemplate.alertKey}</h1>
        <p className="text-sm text-gray-500">Personalizando só para o evento: <strong>{event.title}</strong></p>
      </div>
      <p className="text-sm text-gray-500">
        {isOverride
          ? "Este evento já tem um texto próprio para este alerta."
          : "Este evento ainda usa o texto global — salvar aqui cria uma personalização só para ele."}
      </p>
      <MessageTemplateEditor
        templateId={eventRow?.id ?? null}
        saveUrl={`/api/admin/message-templates/${id}/eventos/${eventId}`}
        showPreviewAndTestSend={false}
        isOverride={isOverride}
        deleteUrl={isOverride ? `/api/admin/message-templates/${id}/eventos/${eventId}` : undefined}
        initialSubject={initialSubject}
        initialBody={initialBody}
        initialRowTemplate={initialRowTemplate}
        initialActive={initialActive}
        channel={globalTemplate.channel as "EMAIL" | "WHATSAPP"}
        variables={variables}
        rowVariables={rowVariables}
        versions={[]}
      />
    </div>
  );
}
