"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  messageBody: string;
};

type PrepareSummary = {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
  // Só populados quando o resumo vem de GET recipients/summary (depois de algum envio já ter
  // acontecido) — a resposta de POST prepare-recipients nunca tem esses status ainda, porque nada
  // foi enviado no momento da preparação.
  sent?: number;
  delivered?: number;
  read?: number;
  failed?: number;
};

type VariableDef = { name: string; label: string; category: string; description: string; sample: string };
type AlertOption = { alertKey: string; description: string; body: string };

// GET recipients/summary retorna uma contagem agrupada por status (groupBy do Prisma), ex.:
// { PENDING: 8, OPTED_OUT: 1 } — formato diferente do PrepareSummary acima (que vem do POST
// prepare-recipients, com chaves fixas). Traduzimos aqui pra reaproveitar o mesmo card de exibição
// pros dois casos.
function summaryFromGrouped(grouped: Record<string, number>): PrepareSummary {
  return {
    total: Object.values(grouped).reduce((sum, n) => sum + n, 0),
    pending: grouped.PENDING ?? 0,
    optedOut: grouped.OPTED_OUT ?? 0,
    invalidPhone: grouped.INVALID_PHONE ?? 0,
    duplicate: grouped.SKIPPED ?? 0,
    sent: grouped.SENT ?? 0,
    delivered: grouped.DELIVERED ?? 0,
    read: grouped.READ ?? 0,
    failed: grouped.FAILED ?? 0,
  };
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  PREPARING: "Preparando",
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
  FAILED: "Falhou",
};

export default function CampaignsManager({
  apiBase,
  backHref,
  scopeLabel,
  allowManualRecipients = false,
}: {
  apiBase: string;
  backHref: string;
  scopeLabel: string;
  allowManualRecipients?: boolean;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", messageBody: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", messageBody: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [pausingConfirmId, setPausingConfirmId] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [resumingConfirmId, setResumingConfirmId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [deletingConfirmId, setDeletingConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [preparingConfirmId, setPreparingConfirmId] = useState<string | null>(null);
  const [manualSelectId, setManualSelectId] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState("");
  const [appliedManualSearch, setAppliedManualSearch] = useState("");
  const [manualRows, setManualRows] = useState<{ id: string; name: string; email: string; phone: string | null }[]>([]);
  const [manualPage, setManualPage] = useState(1);
  const [manualTotalPages, setManualTotalPages] = useState(1);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSelectedIds, setManualSelectedIds] = useState<Set<string>>(new Set());
  const [manualPreparing, setManualPreparing] = useState(false);
  const [recipientSummaries, setRecipientSummaries] = useState<Record<string, PrepareSummary>>({});
  const [variables, setVariables] = useState<VariableDef[]>([]);
  const [alertOptions, setAlertOptions] = useState<AlertOption[]>([]);
  const [selectedAlertKey, setSelectedAlertKey] = useState("");
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testSendLoading, setTestSendLoading] = useState(false);
  const [testSendMessage, setTestSendMessage] = useState<string | null>(null);
  const [sendToNumberInput, setSendToNumberInput] = useState("");
  const [sendingToNumber, setSendingToNumber] = useState(false);
  const [sendToNumberMessage, setSendToNumberMessage] = useState<string | null>(null);
  const [confirmingSendToNumber, setConfirmingSendToNumber] = useState(false);
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [scheduledAtInput, setScheduledAtInput] = useState("");
  const [confirmingDispatch, setConfirmingDispatch] = useState(false);
  const createBodyRef = useRef<HTMLTextAreaElement>(null);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);

  async function reload() {
    const res = await fetch(apiBase);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar campanhas");
      return;
    }
    setPageError(null);
    const list: Campaign[] = data.campaigns ?? [];
    setCampaigns(list);

    // Recupera o resumo de destinatários de cada campanha (perdido em memória a cada reload) sem
    // esperar o operador clicar em "Preparar destinatários" de novo — essa ação é cara (reconstrói
    // a lista do zero). Uma campanha nunca preparada retorna um groupBy vazio; nesse caso não
    // populamos a entrada, pra não exibir um card "Total: 0" pra quem ainda não preparou nada.
    const summaryEntries = await Promise.all(
      list.map(async (campaign) => {
        const summaryRes = await fetch(`${apiBase}/${campaign.id}/recipients/summary`);
        if (!summaryRes.ok) return null;
        const summaryData = await summaryRes.json().catch(() => ({}));
        const grouped = summaryData.summary as Record<string, number> | undefined;
        if (!grouped || Object.keys(grouped).length === 0) return null;
        return [campaign.id, summaryFromGrouped(grouped)] as const;
      }),
    );
    setRecipientSummaries((prev) => {
      const next = { ...prev };
      for (const entry of summaryEntries) {
        if (entry) next[entry[0]] = entry[1];
      }
      return next;
    });
  }

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    void (async () => {
      const [variablesRes, alertOptionsRes] = await Promise.all([
        fetch(`${apiBase}/variables`),
        fetch(`${apiBase}/alert-options`),
      ]);
      if (variablesRes.ok) {
        const data = await variablesRes.json();
        setVariables(data.variables ?? []);
      }
      if (alertOptionsRes.ok) {
        const data = await alertOptionsRes.json();
        setAlertOptions(data.options ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        ...(form.description ? { description: form.description } : {}),
        messageBody: form.messageBody,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setFormError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          (data.unknownVariables?.length
            ? `Variáveis desconhecidas: ${data.unknownVariables.map((v: string) => `{{${v}}}`).join(", ")}`
            : undefined) ??
          (typeof data.error === "string" ? data.error : undefined) ??
          "Erro ao criar campanha",
      );
    } else {
      setShowForm(false);
      setForm({ name: "", description: "", messageBody: "" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(campaign: Campaign) {
    setEditId(campaign.id);
    setEditForm({
      name: campaign.name,
      description: campaign.description ?? "",
      messageBody: campaign.messageBody,
    });
    setPreviewResult(null);
    setTestSendMessage(null);
    setScheduledAtInput("");
    setConfirmingDispatch(false);
    setSendToNumberInput("");
    setSendToNumberMessage(null);
    setConfirmingSendToNumber(false);
  }

  function insertVariable(
    variableName: string,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    value: string,
    setValue: (next: string) => void,
  ) {
    const el = ref.current;
    const token = `{{${variableName}}}`;
    if (!el) {
      setValue(`${value}${token}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  async function saveCampaignEdits(): Promise<boolean> {
    if (!editId) return false;
    const res = await fetch(`${apiBase}/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description.trim() || null,
        messageBody: editForm.messageBody,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setActionError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          (data.unknownVariables?.length
            ? `Variáveis desconhecidas: ${data.unknownVariables.map((v: string) => `{{${v}}}`).join(", ")}`
            : undefined) ??
          (typeof data.error === "string" ? data.error : undefined) ??
          "Erro ao salvar campanha",
      );
      return false;
    }
    return true;
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditSaving(true);
    const ok = await saveCampaignEdits();
    setEditSaving(false);
    if (!ok) return;
    setEditId(null);
    await reload();
  }

  async function doCancel() {
    if (!cancelingId) return;
    setCanceling(true);
    const res = await fetch(`${apiBase}/${cancelingId}/cancel`, { method: "POST" });
    setCanceling(false);
    setCancelingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao cancelar campanha");
      return;
    }
    await reload();
  }

  function canDeleteCampaign(campaignId: string): boolean {
    const summary = recipientSummaries[campaignId];
    if (!summary) return true;
    return (summary.sent ?? 0) + (summary.delivered ?? 0) + (summary.read ?? 0) + (summary.failed ?? 0) === 0;
  }

  async function doDelete() {
    if (!deletingConfirmId) return;
    setDeleting(true);
    const res = await fetch(`${apiBase}/${deletingConfirmId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao excluir campanha");
      return;
    }
    await reload();
  }

  async function doPause() {
    if (!pausingConfirmId) return;
    setPausing(true);
    const res = await fetch(`${apiBase}/${pausingConfirmId}/pause`, { method: "POST" });
    setPausing(false);
    setPausingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao pausar campanha");
      return;
    }
    await reload();
  }

  async function doResume() {
    if (!resumingConfirmId) return;
    setResuming(true);
    const res = await fetch(`${apiBase}/${resumingConfirmId}/resume`, { method: "POST" });
    setResuming(false);
    setResumingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao retomar campanha");
      return;
    }
    await reload();
  }

  async function doDuplicate(campaignId: string) {
    const res = await fetch(`${apiBase}/${campaignId}/duplicate`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao duplicar campanha");
      return;
    }
    await reload();
  }

  async function doPrepareRecipients(campaignId: string) {
    setPreparingId(campaignId);
    const res = await fetch(`${apiBase}/${campaignId}/prepare-recipients`, { method: "POST" });
    setPreparingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao preparar destinatários");
      return;
    }
    const data = await res.json();
    setRecipientSummaries((prev) => ({ ...prev, [campaignId]: data.summary }));
  }

  async function loadManualDirectory(page: number, q: string) {
    setManualLoading(true);
    setAppliedManualSearch(q);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/campaigns/recipients-directory?${params}`);
    setManualLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setManualRows(data.rows);
    setManualPage(data.page);
    setManualTotalPages(data.totalPages);
  }

  function openManualSelect(campaignId: string) {
    setManualSelectId(campaignId);
    setManualSearch("");
    setAppliedManualSearch("");
    setManualSelectedIds(new Set());
    void loadManualDirectory(1, "");
  }

  async function selectAllManual() {
    const params = new URLSearchParams();
    if (appliedManualSearch) params.set("q", appliedManualSearch);
    const res = await fetch(`/api/admin/campaigns/recipients-directory/ids?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setManualSelectedIds((prev) => new Set([...prev, ...(data.ids as string[])]));
  }

  function deselectAllManual() {
    setManualSelectedIds(new Set());
  }

  function toggleManualId(id: string) {
    setManualSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmManualPrepare() {
    if (!manualSelectId) return;
    setManualPreparing(true);
    const res = await fetch(`${apiBase}/${manualSelectId}/prepare-recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ athleteUserIds: Array.from(manualSelectedIds) }),
    });
    setManualPreparing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao preparar destinatários");
      return;
    }
    const data = await res.json();
    setRecipientSummaries((prev) => ({ ...prev, [manualSelectId]: data.summary }));
    setManualSelectId(null);
  }

  async function doPreview() {
    if (!editId) return;
    setPreviewLoading(true);
    setActionError(null);
    const res = await fetch(`${apiBase}/${editId}/preview`, { method: "POST" });
    setPreviewLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao gerar pré-visualização");
      return;
    }
    setPreviewResult(data.body);
  }

  async function doTestSend() {
    if (!editId) return;
    setTestSendLoading(true);
    setActionError(null);
    setTestSendMessage(null);
    const res = await fetch(`${apiBase}/${editId}/test-send`, { method: "POST" });
    setTestSendLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao enviar teste");
      return;
    }
    setTestSendMessage("Teste enviado para o seu telefone cadastrado.");
  }

  async function doSendToNumber() {
    if (!editId) return;
    setSendingToNumber(true);
    setActionError(null);
    setSendToNumberMessage(null);
    const res = await fetch(`${apiBase}/${editId}/send-to-number`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: sendToNumberInput }),
    });
    setSendingToNumber(false);
    setConfirmingSendToNumber(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao enviar pro número informado");
      return;
    }
    setSendToNumberMessage(`Mensagem enviada para ${sendToNumberInput}.`);
  }

  async function doSchedule(sendNow: boolean) {
    if (!editId) return;
    setSchedulingLoading(true);
    setActionError(null);

    // Salva as edições pendentes do formulário ANTES de agendar/disparar — sem isso, clicar aqui sem
    // antes clicar em "Salvar" enviava o messageBody já salvo anteriormente, descartando
    // silenciosamente o texto recém-digitado, para destinatários reais, de forma irreversível.
    const saved = await saveCampaignEdits();
    if (!saved) {
      setSchedulingLoading(false);
      return;
    }

    const res = await fetch(`${apiBase}/${editId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendNow ? {} : { scheduledAt: new Date(scheduledAtInput).toISOString() }),
    });
    setSchedulingLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao agendar/disparar campanha");
      return;
    }
    setEditId(null);
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!cancelingId}
        title="Cancelar campanha"
        message="Deseja cancelar esta campanha? Essa ação não pode ser desfeita."
        tone="danger"
        loading={canceling}
        onConfirm={doCancel}
        onCancel={() => setCancelingId(null)}
      />

      <ConfirmModal
        open={!!deletingConfirmId}
        title="Excluir campanha"
        message="Isso vai apagar esta campanha permanentemente — diferente de cancelar, que só muda o status. Essa ação não pode ser desfeita. Deseja continuar?"
        confirmLabel="Excluir"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingConfirmId(null)}
      />

      <ConfirmModal
        open={!!pausingConfirmId}
        title="Pausar campanha"
        message="Isso vai parar o envio desta campanha imediatamente. Os destinatários que ainda não receberam a mensagem continuam pendentes e o envio pode ser retomado depois. Deseja continuar?"
        confirmLabel="Pausar"
        tone="danger"
        loading={pausing}
        onConfirm={doPause}
        onCancel={() => setPausingConfirmId(null)}
      />

      <ConfirmModal
        open={!!resumingConfirmId}
        title="Retomar campanha"
        message="Isso vai voltar a enviar mensagens reais de WhatsApp pros destinatários pendentes desta campanha. Se a pausa foi causada por falhas consecutivas de envio, o contador de falhas também será reiniciado. Deseja continuar?"
        confirmLabel="Retomar"
        tone="danger"
        loading={resuming}
        onConfirm={doResume}
        onCancel={() => setResumingConfirmId(null)}
      />

      <div className="relative z-[60]">
        <ConfirmModal
          open={confirmingSendToNumber}
          title="Enviar para número específico"
          message={`Isso vai enviar uma mensagem de WhatsApp real e imediata para ${sendToNumberInput}, sem passar pela fila de campanha. Essa ação não pode ser desfeita. Deseja continuar?`}
          confirmLabel="Enviar"
          tone="danger"
          loading={sendingToNumber}
          onConfirm={doSendToNumber}
          onCancel={() => setConfirmingSendToNumber(false)}
        />
      </div>

      <ConfirmModal
        open={!!preparingConfirmId}
        title="Preparar destinatários"
        message="Isso vai apagar a lista de destinatários atual (se houver) e reconstruí-la do zero, varrendo toda a base elegível. Pode demorar um pouco. Deseja continuar?"
        confirmLabel="Preparar"
        loading={preparingId !== null && preparingId === preparingConfirmId}
        onConfirm={async () => {
          const campaignId = preparingConfirmId;
          if (!campaignId) return;
          await doPrepareRecipients(campaignId);
          setPreparingConfirmId(null);
        }}
        onCancel={() => setPreparingConfirmId(null)}
      />

      <div className="relative z-[60]">
        <ConfirmModal
          open={confirmingDispatch}
          title="Disparar agora"
          message="Isso vai enviar mensagens reais de WhatsApp para todos os destinatários já preparados desta campanha, imediatamente. Essa ação não pode ser desfeita. Deseja continuar?"
          confirmLabel="Disparar"
          tone="danger"
          loading={schedulingLoading}
          onConfirm={async () => {
            await doSchedule(true);
            setConfirmingDispatch(false);
          }}
          onCancel={() => setConfirmingDispatch(false)}
        />
      </div>

      {previewResult !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreviewResult(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pré-visualização</h2>
            <p className="whitespace-pre-wrap text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3">{previewResult}</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setPreviewResult(null)} className="btn-secondary text-sm px-4">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {manualSelectId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setManualSelectId(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-lg mx-4 space-y-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Selecionar destinatários</h2>
            <div className="flex gap-2">
              <input
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadManualDirectory(1, manualSearch);
                }}
                placeholder="Buscar por nome, e-mail ou telefone"
                className="input flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => void loadManualDirectory(1, manualSearch)}
                className="btn-secondary text-sm px-3"
              >
                Buscar
              </button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{manualSelectedIds.size} selecionado(s)</span>
              <div className="flex gap-3">
                <button type="button" onClick={() => void selectAllManual()} className="text-blue-600 hover:text-blue-800">
                  Marcar todos
                </button>
                <button type="button" onClick={deselectAllManual} className="text-gray-600 hover:text-gray-800">
                  Desmarcar todos
                </button>
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {manualLoading ? (
                <p className="p-3 text-sm text-gray-500">Carregando...</p>
              ) : manualRows.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">Nenhum atleta encontrado.</p>
              ) : (
                manualRows.map((row) => (
                  <label key={row.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={manualSelectedIds.has(row.id)} onChange={() => toggleManualId(row.id)} />
                    <span className="flex-1">
                      {row.name} <span className="text-gray-400">— {row.phone ?? "sem telefone"}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {manualTotalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  disabled={manualPage <= 1}
                  onClick={() => void loadManualDirectory(manualPage - 1, appliedManualSearch)}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  ‹ Anterior
                </button>
                <span className="text-gray-500">
                  Página {manualPage} de {manualTotalPages}
                </span>
                <button
                  type="button"
                  disabled={manualPage >= manualTotalPages}
                  onClick={() => void loadManualDirectory(manualPage + 1, appliedManualSearch)}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  Próxima ›
                </button>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setManualSelectId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmManualPrepare()}
                disabled={manualPreparing || manualSelectedIds.size === 0}
                className="btn-primary text-sm px-4 disabled:opacity-50"
              >
                {manualPreparing ? "Preparando..." : `Preparar com ${manualSelectedIds.size} destinatário(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {editId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => {
            setEditId(null);
            setPreviewResult(null);
            setTestSendMessage(null);
            setScheduledAtInput("");
            setConfirmingDispatch(false);
          }}
        >
          <form
            onSubmit={saveEdit}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-2xl mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar campanha</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
              <input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="input w-full"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
                  <textarea
                    required
                    ref={editBodyRef}
                    value={editForm.messageBody}
                    onChange={(e) => setEditForm({ ...editForm, messageBody: e.target.value })}
                    className="input w-full"
                    rows={6}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        insertVariable(e.target.value, editBodyRef, editForm.messageBody, (v) => setEditForm({ ...editForm, messageBody: v }));
                      }
                      e.target.value = "";
                    }}
                    className="input text-sm"
                  >
                    <option value="">+ Inserir variável...</option>
                    {[...new Set(variables.map((v) => v.category))].map((cat) => (
                      <optgroup key={cat} label={cat}>
                        {variables
                          .filter((v) => v.category === cat)
                          .map((v) => (
                            <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">{editForm.messageBody.length} caracteres</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pré-visualização ao vivo</label>
                <p className="whitespace-pre-wrap text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 min-h-[9rem]">
                  {renderTemplate(editForm.messageBody, SAMPLE_VALUES, "WHATSAPP") || "Digite a mensagem para ver a pré-visualização..."}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Usa dados de amostra — o botão "Visualizar" abaixo mostra o texto exato com o rodapé de preferências.
                </p>
              </div>
            </div>
            {testSendMessage && <p className="text-sm text-green-700 dark:text-green-400">{testSendMessage}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void doPreview()}
                disabled={previewLoading}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {previewLoading ? "Gerando..." : "Visualizar"}
              </button>
              <button
                type="button"
                onClick={() => void doTestSend()}
                disabled={testSendLoading}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {testSendLoading ? "Enviando..." : "Enviar teste"}
              </button>
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={sendToNumberInput}
                onChange={(e) => setSendToNumberInput(e.target.value)}
                placeholder="Telefone (ex: 11988888888)"
                className="input text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => setConfirmingSendToNumber(true)}
                disabled={sendingToNumber || !sendToNumberInput.trim()}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {sendingToNumber ? "Enviando..." : "Enviar para este número"}
              </button>
            </div>
            {sendToNumberMessage && <p className="text-sm text-green-700 dark:text-green-400">{sendToNumberMessage}</p>}
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
              <input
                type="datetime-local"
                value={scheduledAtInput}
                onChange={(e) => setScheduledAtInput(e.target.value)}
                className="input text-sm"
              />
              <button
                type="button"
                onClick={() => void doSchedule(false)}
                disabled={schedulingLoading || !scheduledAtInput}
                className="btn-secondary text-sm px-3 disabled:opacity-50"
              >
                Agendar envio
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDispatch(true)}
                disabled={schedulingLoading}
                className="text-sm px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              >
                {schedulingLoading ? "Enviando..." : "Disparar agora"}
              </button>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditId(null);
                  setPreviewResult(null);
                  setTestSendMessage(null);
                  setScheduledAtInput("");
                  setConfirmingDispatch(false);
                }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium"
              >
                {editSaving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ErrorModal message={actionError} onClose={() => setActionError(null)} />

      <div className="flex items-center justify-between">
        <div>
          <Link href={backHref} className="text-sm text-gray-500 hover:text-primary-600">
            ← Voltar
          </Link>
          <h1 className="text-xl font-bold mt-1">Campanhas de WhatsApp</h1>
          <p className="text-sm text-gray-500">Mensagens promocionais em massa {scopeLabel}.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          + Nova campanha
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Nova campanha</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">
              {formError}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input w-full"
              placeholder="Ex: Últimas vagas — Corrida de Verão"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full"
            />
          </div>
          {alertOptions.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Começar a partir de um alerta existente (opcional)
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedAlertKey}
                  onChange={(e) => setSelectedAlertKey(e.target.value)}
                  className="input flex-1 text-sm"
                >
                  <option value="">Selecione um alerta...</option>
                  {alertOptions.map((opt) => (
                    <option key={opt.alertKey} value={opt.alertKey}>{opt.description}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const opt = alertOptions.find((o) => o.alertKey === selectedAlertKey);
                    if (opt) setForm({ ...form, messageBody: opt.body });
                  }}
                  disabled={!selectedAlertKey}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  Usar este texto
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea
              required
              ref={createBodyRef}
              value={form.messageBody}
              onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
              className="input w-full"
              rows={4}
              placeholder="Escreva a mensagem que será enviada..."
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  insertVariable(e.target.value, createBodyRef, form.messageBody, (v) => setForm({ ...form, messageBody: v }));
                }
                e.target.value = "";
              }}
              className="input text-sm"
            >
              <option value="">+ Inserir variável...</option>
              {[...new Set(variables.map((v) => v.category))].map((cat) => (
                <optgroup key={cat} label={cat}>
                  {variables
                    .filter((v) => v.category === cat)
                    .map((v) => (
                      <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className="text-xs text-gray-400">{form.messageBody.length} caracteres</span>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Criando..." : "Criar"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {pageError ? (
        <div className="card text-center py-8 text-red-600 dark:text-red-400">{pageError}</div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhuma campanha cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {campaign.name}{" "}
                    <span className="text-xs text-gray-400">({STATUS_LABEL[campaign.status] ?? campaign.status})</span>
                  </p>
                  {campaign.description && <p className="text-sm text-gray-500">{campaign.description}</p>}
                  <p className="text-sm text-gray-400 truncate max-w-md">{campaign.messageBody}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {campaign.status === "DRAFT" && (
                    <>
                      <button onClick={() => openEdit(campaign)} className="text-blue-600 hover:text-blue-800 text-sm">
                        Editar
                      </button>
                      <button onClick={() => setCancelingId(campaign.id)} className="text-red-500 hover:text-red-700 text-sm">
                        Cancelar
                      </button>
                      <button
                        onClick={() => setPreparingConfirmId(campaign.id)}
                        disabled={preparingId === campaign.id}
                        className="text-green-700 hover:text-green-900 text-sm"
                      >
                        {preparingId === campaign.id ? "Preparando..." : "Preparar destinatários"}
                      </button>
                      {allowManualRecipients && (
                        <button
                          onClick={() => openManualSelect(campaign.id)}
                          className="text-green-700 hover:text-green-900 text-sm"
                        >
                          Selecionar destinatários
                        </button>
                      )}
                    </>
                  )}
                  {campaign.status === "SCHEDULED" && (
                    <button onClick={() => setCancelingId(campaign.id)} className="text-red-500 hover:text-red-700 text-sm">
                      Cancelar
                    </button>
                  )}
                  {campaign.status === "RUNNING" && (
                    <button onClick={() => setPausingConfirmId(campaign.id)} className="text-amber-600 hover:text-amber-800 text-sm">
                      Pausar
                    </button>
                  )}
                  {campaign.status === "PAUSED" && (
                    <button onClick={() => setResumingConfirmId(campaign.id)} className="text-green-700 hover:text-green-900 text-sm">
                      Retomar
                    </button>
                  )}
                  <button onClick={() => void doDuplicate(campaign.id)} className="text-gray-600 hover:text-gray-800 text-sm">
                    Duplicar
                  </button>
                  {canDeleteCampaign(campaign.id) && (
                    <button onClick={() => setDeletingConfirmId(campaign.id)} className="text-red-700 hover:text-red-900 text-sm">
                      Excluir
                    </button>
                  )}
                </div>
              </div>
              {recipientSummaries[campaign.id] && (
                <p className="text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-2">
                  Total: {recipientSummaries[campaign.id].total} · Elegíveis:{" "}
                  {recipientSummaries[campaign.id].pending} · Opt-out:{" "}
                  {recipientSummaries[campaign.id].optedOut} · Telefone inválido:{" "}
                  {recipientSummaries[campaign.id].invalidPhone} · Duplicados:{" "}
                  {recipientSummaries[campaign.id].duplicate} · Enviados:{" "}
                  {recipientSummaries[campaign.id].sent ?? 0} · Entregues:{" "}
                  {recipientSummaries[campaign.id].delivered ?? 0} · Lidos:{" "}
                  {recipientSummaries[campaign.id].read ?? 0} · Falhou:{" "}
                  {recipientSummaries[campaign.id].failed ?? 0}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
