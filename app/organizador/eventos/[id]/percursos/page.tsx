"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Route = { id: string; name: string; distanceKm: number; description?: string | null };

export default function PercursosPage() {
  const { id } = useParams<{ id: string }>();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", distanceKm: "", description: "" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/routes`);
      const data = await res.json();
      setRoutes(data.routes ?? []);
      setLoading(false);
    };

    void load();
  }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/events/${id}/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, distanceKm: parseFloat(form.distanceKm), description: form.description || null }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", distanceKm: "", description: "" });
    const reload = await fetch(`/api/events/${id}/routes`);
    const data = await reload.json();
    setRoutes(data.routes ?? []);
  }

  async function handleDelete(routeId: string) {
    if (!confirm("Remover este percurso?")) return;
    await fetch(`/api/events/${id}/routes/${routeId}`, { method: "DELETE" });
    const reload = await fetch(`/api/events/${id}/routes`);
    const data = await reload.json();
    setRoutes(data.routes ?? []);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
          <h1 className="text-xl font-bold mt-1">Percursos</h1>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo percurso</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo percurso</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="5km" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Distância (km)</label>
              <input required type="number" step="0.1" min="0" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })} className="input w-full" placeholder="5" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descrição (opcional)</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Salvando..." : "Adicionar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {routes.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum percurso cadastrado.</div>
      ) : (
        <div className="space-y-2">
          {routes.map((r) => (
            <div key={r.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-gray-500">{r.distanceKm}km{r.description ? ` · ${r.description}` : ""}</p>
              </div>
              <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
