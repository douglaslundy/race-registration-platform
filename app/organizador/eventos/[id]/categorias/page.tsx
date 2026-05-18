"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Category = { id: string; name: string; description?: string | null; minAge?: number | null; maxAge?: number | null; gender?: string | null };

export default function CategoriasPage() {
  const { id } = useParams<{ id: string }>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", minAge: "", maxAge: "", gender: "" });

  async function load() {
    const res = await fetch(`/api/events/${id}/categories`);
    const data = await res.json();
    setCategories(data.categories ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

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
    load();
  }

  async function handleDelete(catId: string) {
    if (!confirm("Remover esta categoria?")) return;
    await fetch(`/api/events/${id}/categories/${catId}`, { method: "DELETE" });
    load();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6">
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
              <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
