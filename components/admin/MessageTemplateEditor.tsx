"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";
import ConfirmModal from "@/components/ui/ConfirmModal";

interface VariableDef {
  name: string;
  label: string;
  category: string;
  description: string;
}

interface VersionRow {
  id: string;
  subject: string | null;
  body: string;
  active: boolean;
  createdAt: string;
}

export default function MessageTemplateEditor({
  templateId,
  saveUrl,
  showPreviewAndTestSend = true,
  isOverride = false,
  deleteUrl,
  initialSubject,
  initialBody,
  initialRowTemplate,
  initialActive,
  channel,
  variables,
  rowVariables,
  versions,
}: {
  templateId: string | null;
  saveUrl: string;
  showPreviewAndTestSend?: boolean;
  isOverride?: boolean;
  deleteUrl?: string;
  initialSubject: string | null;
  initialBody: string;
  initialRowTemplate?: string | null;
  initialActive: boolean;
  channel: "EMAIL" | "WHATSAPP";
  variables: VariableDef[];
  rowVariables?: VariableDef[];
  versions: VersionRow[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody);
  const [rowTemplate, setRowTemplate] = useState(initialRowTemplate ?? "");
  const [active, setActive] = useState(initialActive);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ subject?: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reverting, setReverting] = useState<{ versionId: string } | null>(null);
  const [reverting_loading, setRevertingLoading] = useState(false);
  const [confirmingDeleteOverride, setConfirmingDeleteOverride] = useState(false);
  const [deletingOverride, setDeletingOverride] = useState(false);

  const filteredVariables = variables.filter(
    (v) =>
      v.name.includes(search.toLowerCase()) ||
      v.label.toLowerCase().includes(search.toLowerCase()),
  );
  const categories = [...new Set(filteredVariables.map((v) => v.category))];

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await fetch(saveUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: channel === "EMAIL" ? subject : undefined,
        body,
        ...(rowVariables && rowVariables.length > 0 ? { rowTemplate } : {}),
        active,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(
        data.unknownVariables?.length
          ? `Variáveis desconhecidas: ${data.unknownVariables.map((v: string) => `{{${v}}}`).join(", ")}`
          : data.error ?? "Erro ao salvar",
      );
      return;
    }
    setMessage("Salvo com sucesso.");
  }

  async function handlePreview() {
    setError(null);
    const res = await fetch(`/api/admin/message-templates/${templateId}/preview`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Erro ao gerar pré-visualização");
      return;
    }
    setPreview(data);
  }

  async function handleTestSend() {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/admin/message-templates/${templateId}/test-send`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Erro ao enviar teste");
      return;
    }
    setMessage("Teste enviado para o seu e-mail/WhatsApp cadastrado.");
  }

  async function handleRevert(versionId: string) {
    setRevertingLoading(true);
    setError(null);
    const res = await fetch(
      `/api/admin/message-templates/${templateId}/revert/${versionId}`,
      { method: "POST" },
    );
    const data = await res.json().catch(() => ({}));
    setRevertingLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Erro ao reverter");
      setReverting(null);
      return;
    }
    setSubject(data.template.subject ?? "");
    setBody(data.template.body);
    setActive(data.template.active);
    setMessage("Revertido com sucesso — o template já está usando o conteúdo da versão anterior.");
    setReverting(null);
  }

  async function handleDeleteOverride() {
    if (!deleteUrl) return;
    setDeletingOverride(true);
    setError(null);
    const res = await fetch(deleteUrl, { method: "DELETE" });
    setDeletingOverride(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao remover personalização");
      setConfirmingDeleteOverride(false);
      return;
    }
    router.push("/admin/alertas");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="card space-y-4">
        {channel === "EMAIL" && (
          <div>
            <label className="block text-sm font-medium mb-1">Assunto</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input-field"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Corpo da mensagem</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="input-field font-mono text-sm"
          />
        </div>
        {rowVariables && rowVariables.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Template de cada linha</label>
            <textarea
              value={rowTemplate}
              onChange={(e) => setRowTemplate(e.target.value)}
              rows={3}
              className="input-field font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Aplicado a cada item da lista (ex.: cada divergência de conciliação), repetido automaticamente pelo sistema.
            </p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          Usar este texto personalizado (desmarcado = volta pro texto padrão do sistema)
        </label>
        <p className="text-xs text-gray-500">
          Isso não liga nem desliga o alerta — ele continua sendo enviado normalmente nos dois
          casos. Essa opção só decide se usa o seu texto ou o texto padrão do sistema.
        </p>

        {message && <p className="text-sm text-green-700 dark:text-green-400">{message}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-6 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
          {showPreviewAndTestSend && templateId && (
            <>
              <button type="button" onClick={handlePreview} className="btn-secondary px-4">
                Pré-visualizar
              </button>
              <button type="button" onClick={handleTestSend} className="btn-secondary px-4">
                Enviar teste pra mim
              </button>
            </>
          )}
          {deleteUrl && isOverride && (
            <button
              type="button"
              onClick={() => setConfirmingDeleteOverride(true)}
              className="btn-secondary px-4 text-red-600"
            >
              Remover personalização (voltar ao texto global)
            </button>
          )}
        </div>

        {preview && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
            {preview.subject && <p className="font-semibold mb-2">{preview.subject}</p>}
            {channel === "EMAIL" ? (
              <div dangerouslySetInnerHTML={{ __html: preview.body }} />
            ) : (
              <p className="whitespace-pre-wrap">{preview.body}</p>
            )}
          </div>
        )}

        {versions.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500">
              Histórico ({versions.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">
                    {new Date(v.createdAt).toLocaleString("pt-BR")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReverting({ versionId: v.id })}
                    className="text-primary-700 dark:text-primary-400 hover:underline"
                  >
                    Reverter pra esta versão
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Variáveis disponíveis</h2>
        <input
          placeholder="Buscar variável..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
        />
        {categories.map((cat) => (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mt-2">{cat}</h3>
            <ul className="space-y-1 mt-1">
              {filteredVariables
                .filter((v) => v.category === cat)
                .map((v) => (
                  <li key={v.name} className="text-sm">
                    <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                      {`{{${v.name}}}`}
                    </code>{" "}
                    <span className="text-gray-500">{v.label}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {rowVariables && rowVariables.length > 0 && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mt-2">Variáveis do template de cada linha</h3>
            <ul className="space-y-1 mt-1">
              {rowVariables.map((v) => (
                <li key={v.name} className="text-sm">
                  <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{`{{${v.name}}}`}</code>{" "}
                  <span className="text-gray-500">{v.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ErrorModal message={error} onClose={() => setError(null)} />
      <ConfirmModal
        open={reverting !== null}
        title="Reverter para esta versão"
        message="Esta ação vai restaurar o conteúdo da versão anterior. A mudança será aplicada imediatamente."
        confirmLabel="Reverter"
        tone="default"
        loading={reverting_loading}
        onConfirm={() => reverting && handleRevert(reverting.versionId)}
        onCancel={() => setReverting(null)}
      />
      <ConfirmModal
        open={confirmingDeleteOverride}
        title="Remover personalização"
        message="Isso remove o texto customizado deste evento — ele volta a usar o texto global."
        confirmLabel="Remover"
        tone="danger"
        loading={deletingOverride}
        onConfirm={handleDeleteOverride}
        onCancel={() => setConfirmingDeleteOverride(false)}
      />
    </div>
  );
}
