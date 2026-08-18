"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";

type Sponsor = {
  id: string;
  name: string;
  url: string;
  message: string;
  active: boolean;
};

export default function PatrocinioPage() {
  const { id } = useParams<{ id: string }>();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", message: "", active: true });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", message: "" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/sponsors`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPageError(data.error ?? "Erro ao carregar patrocinadores");
        setLoading(false);
        return;
      }
      setPageError(null);
      setSponsors(data.sponsors ?? []);
      setLoading(false);
    };
    void load();
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/events/${id}/sponsors`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar patrocinadores");
      return;
    }
    setPageError(null);
    setSponsors(data.sponsors ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${id}/sponsors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, url: form.url, message: form.message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setFormError(
        data.error?.formErrors?.[0] ??
        (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
        "Erro ao criar patrocinador",
      );
    } else {
      setShowForm(false);
      setForm({ name: "", url: "", message: "" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(sponsor: Sponsor) {
    setEditId(sponsor.id);
    setEditForm({ name: sponsor.name, url: sponsor.url, message: sponsor.message, active: sponsor.active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/sponsors/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editForm.name, url: editForm.url, message: editForm.message, active: editForm.active }),
    });
    setEditSaving(false);
    setEditId(null);
    await reload();
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    await fetch(`/api/events/${id}/sponsors/${deletingId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingId(null);
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!deletingId}
        title="Remover patrocinador"
        message="Deseja remover este patrocinador do evento? Ele deixa de ser incluído nas próximas mensagens de confirmação."
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar patrocinador</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link</label>
              <input required value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea required value={editForm.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} className="input w-full" rows={3} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="h-4 w-4" />
              Ativo
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setEditId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="submit" disabled={editSaving} className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium">{editSaving ? "Salvando…" : "Salvar"}</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
          <h1 className="text-xl font-bold mt-1">Patrocínio</h1>
          <p className="text-sm text-gray-500">Incluídos automaticamente nas mensagens de confirmação de inscrição, enquanto ativos.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo patrocinador</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo patrocinador</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Nome do patrocinador" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link *</label>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input w-full" placeholder="https://patrocinador.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input w-full" rows={3} placeholder="Confira nosso patrocinador!" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {pageError ? (
        <div className="card text-center py-8 text-red-600 dark:text-red-400">{pageError}</div>
      ) : sponsors.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum patrocinador cadastrado.</div>
      ) : (
        <div className="space-y-2">
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{sponsor.name} {!sponsor.active && <span className="text-xs text-gray-400">(inativo)</span>}</p>
                <p className="text-sm text-gray-500">{sponsor.url}</p>
                <p className="text-sm text-gray-400 truncate max-w-md">{sponsor.message}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(sponsor)} className="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
                <button onClick={() => setDeletingId(sponsor.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
