"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  messageBody: string;
};

type PrepareSummary = { total: number; pending: number; optedOut: number; invalidPhone: number; duplicate: number };

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
}: {
  apiBase: string;
  backHref: string;
  scopeLabel: string;
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [recipientSummaries, setRecipientSummaries] = useState<Record<string, PrepareSummary>>({});

  async function reload() {
    const res = await fetch(apiBase);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar campanhas");
      return;
    }
    setPageError(null);
    setCampaigns(data.campaigns ?? []);
  }

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
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
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    const res = await fetch(`${apiBase}/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description.trim() || null,
        messageBody: editForm.messageBody,
      }),
    });
    setEditSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setActionError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          (typeof data.error === "string" ? data.error : undefined) ??
          "Erro ao salvar campanha",
      );
      return;
    }
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

      <ErrorModal message={actionError} onClose={() => setActionError(null)} />

      {editId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setEditId(null)}
        >
          <form
            onSubmit={saveEdit}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4"
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
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea
                required
                value={editForm.messageBody}
                onChange={(e) => setEditForm({ ...editForm, messageBody: e.target.value })}
                className="input w-full"
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditId(null)}
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
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea
              required
              value={form.messageBody}
              onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
              className="input w-full"
              rows={4}
              placeholder="Escreva a mensagem que será enviada..."
            />
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
                        onClick={() => void doPrepareRecipients(campaign.id)}
                        disabled={preparingId === campaign.id}
                        className="text-green-700 hover:text-green-900 text-sm"
                      >
                        {preparingId === campaign.id ? "Preparando..." : "Preparar destinatários"}
                      </button>
                    </>
                  )}
                  <button onClick={() => void doDuplicate(campaign.id)} className="text-gray-600 hover:text-gray-800 text-sm">
                    Duplicar
                  </button>
                </div>
              </div>
              {recipientSummaries[campaign.id] && (
                <p className="text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-2">
                  Total: {recipientSummaries[campaign.id].total} · Elegíveis:{" "}
                  {recipientSummaries[campaign.id].pending} · Opt-out:{" "}
                  {recipientSummaries[campaign.id].optedOut} · Telefone inválido:{" "}
                  {recipientSummaries[campaign.id].invalidPhone} · Duplicados:{" "}
                  {recipientSummaries[campaign.id].duplicate}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
