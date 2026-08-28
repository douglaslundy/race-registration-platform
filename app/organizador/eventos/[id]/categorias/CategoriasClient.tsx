"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type Category = { id: string; name: string; description?: string | null; minAge?: number | null; maxAge?: number | null; gender?: string | null };

export default function CategoriasPage() {
  const { id } = useParams<{ id: string }>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", minAge: "", maxAge: "", gender: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", minAge: "", maxAge: "", gender: "" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/categories`);
      const data = await res.json();
      setCategories(data.categories ?? []);
      setLoading(false);
    };

    void load();
  }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/events/${id}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        minAge: form.minAge ? parseInt(form.minAge) : null,
        maxAge: form.maxAge ? parseInt(form.maxAge) : null,
        gender: form.gender || null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", description: "", minAge: "", maxAge: "", gender: "" });
    const res = await fetch(`/api/events/${id}/categories`);
    const data = await res.json();
    setCategories(data.categories ?? []);
  }

  function openEdit(c: Category) {
    setEditId(c.id);
    setEditForm({
      name: c.name,
      minAge: c.minAge != null ? String(c.minAge) : "",
      maxAge: c.maxAge != null ? String(c.maxAge) : "",
      gender: c.gender ?? "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/categories/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        minAge: editForm.minAge ? parseInt(editForm.minAge) : null,
        maxAge: editForm.maxAge ? parseInt(editForm.maxAge) : null,
        gender: editForm.gender || null,
      }),
    });
    setEditSaving(false);
    setEditId(null);
    const res = await fetch(`/api/events/${id}/categories`);
    const data = await res.json();
    setCategories(data.categories ?? []);
  }

  function handleDelete(catId: string) {
    setConfirmDelete(catId);
  }

  async function doDelete(catId: string) {
    setConfirmDelete(null);
    await fetch(`/api/events/${id}/categories/${catId}`, { method: "DELETE" });
    const res = await fetch(`/api/events/${id}/categories`);
    const data = await res.json();
    setCategories(data.categories ?? []);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remover categoria"
        description="Deseja remover esta categoria do evento?"
        confirmLabel="Remover"
        danger
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar categoria</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input w-full" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Idade mín.</label>
                <input type="number" min="0" value={editForm.minAge} onChange={(e) => setEditForm({ ...editForm, minAge: e.target.value })} className="input w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Idade máx.</label>
                <input type="number" min="0" value={editForm.maxAge} onChange={(e) => setEditForm({ ...editForm, maxAge: e.target.value })} className="input w-full" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Gênero</label>
              <select value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} className="input w-full">
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
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
          <h1 className="text-xl font-bold mt-1">Categorias</h1>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Nova categoria</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Nova categoria</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Geral Masculino" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Idade mín.</label>
              <input type="number" min="0" value={form.minAge} onChange={(e) => setForm({ ...form, minAge: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Idade máx.</label>
              <input type="number" min="0" value={form.maxAge} onChange={(e) => setForm({ ...form, maxAge: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gênero</label>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="input w-full">
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Adicionar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {categories.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhuma categoria cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-gray-500">
                  {[c.gender && (c.gender === "M" ? "Masculino" : "Feminino"), c.minAge && `${c.minAge}+`, c.maxAge && `até ${c.maxAge}`].filter(Boolean).join(" · ") || "Todas as idades e gêneros"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
                <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
