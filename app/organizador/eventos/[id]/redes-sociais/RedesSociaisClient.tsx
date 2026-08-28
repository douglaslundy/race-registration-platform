"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";

type SocialLink = {
  id: string;
  platform: string;
  url: string;
  message: string;
  maxSends: number;
  active: boolean;
};

export default function RedesSociaisPage() {
  const { id } = useParams<{ id: string }>();
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ platform: "", url: "", message: "", maxSends: "1", active: true });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ platform: "", url: "", message: "", maxSends: "1" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/social-links`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPageError(data.error ?? "Erro ao carregar redes sociais");
        setLoading(false);
        return;
      }
      setPageError(null);
      setSocialLinks(data.socialLinks ?? []);
      setLoading(false);
    };
    void load();
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/events/${id}/social-links`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar redes sociais");
      return;
    }
    setPageError(null);
    setSocialLinks(data.socialLinks ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${id}/social-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: form.platform,
        url: form.url,
        message: form.message,
        maxSends: parseInt(form.maxSends) || 1,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setFormError(
        data.error?.formErrors?.[0] ??
        (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
        "Erro ao criar rede social",
      );
    } else {
      setShowForm(false);
      setForm({ platform: "", url: "", message: "", maxSends: "1" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(link: SocialLink) {
    setEditId(link.id);
    setEditForm({
      platform: link.platform,
      url: link.url,
      message: link.message,
      maxSends: String(link.maxSends),
      active: link.active,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/social-links/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: editForm.platform,
        url: editForm.url,
        message: editForm.message,
        maxSends: parseInt(editForm.maxSends) || 1,
        active: editForm.active,
      }),
    });
    setEditSaving(false);
    setEditId(null);
    await reload();
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    await fetch(`/api/events/${id}/social-links/${deletingId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingId(null);
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!deletingId}
        title="Remover rede social"
        message="Deseja remover esta rede social do evento? Ela deixa de ser incluída nas próximas mensagens."
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar rede social</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rede</label>
              <input required value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link</label>
              <input required value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea required value={editForm.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} className="input w-full" rows={3} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantas vezes incluir por pessoa</label>
              <input required type="number" min="1" value={editForm.maxSends} onChange={(e) => setEditForm({ ...editForm, maxSends: e.target.value })} className="input w-full" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="h-4 w-4" />
              Ativa
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
          <h1 className="text-xl font-bold mt-1">Redes sociais</h1>
          <p className="text-sm text-gray-500">Incluídas automaticamente nas mensagens de confirmação, carrinho abandonado e erro de pagamento, respeitando o limite de envios.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Nova rede social</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Nova rede social</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rede *</label>
            <input required value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="input w-full" placeholder="Instagram, Strava..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link *</label>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input w-full" placeholder="https://instagram.com/corrida" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input w-full" rows={3} placeholder="Segue a gente no Instagram!" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantas vezes incluir por pessoa</label>
            <input type="number" min="1" value={form.maxSends} onChange={(e) => setForm({ ...form, maxSends: e.target.value })} className="input w-full" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {pageError ? (
        <div className="card text-center py-8 text-red-600 dark:text-red-400">{pageError}</div>
      ) : socialLinks.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhuma rede social cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {socialLinks.map((link) => (
            <div key={link.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{link.platform} {!link.active && <span className="text-xs text-gray-400">(inativa)</span>}</p>
                <p className="text-sm text-gray-500">{link.url} · até {link.maxSends}x por pessoa</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(link)} className="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
                <button onClick={() => setDeletingId(link.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
