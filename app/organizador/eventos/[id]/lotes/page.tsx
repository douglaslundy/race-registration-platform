"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

type Batch = {
  id: string;
  name: string;
  priceAmount: number;
  capacity: number;
  soldCount: number;
  startAt: string;
  endAt: string;
  active: boolean;
  activationMode: string;
  status: string;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: "Vigente",   cls: "bg-green-100 text-green-700" },
  SOLD_OUT: { label: "Esgotado",  cls: "bg-orange-100 text-orange-700" },
  CLOSED:   { label: "Encerrado", cls: "bg-gray-100 text-gray-500" },
  UPCOMING: { label: "Em breve",  cls: "bg-blue-100 text-blue-700" },
  INACTIVE: { label: "Inativo",   cls: "bg-gray-100 text-gray-500" },
};

const ACTIVATION_LABEL: Record<string, string> = {
  MANUAL:          "Manual",
  DATE:            "Por data",
  AFTER_PREVIOUS:  "Após lote anterior",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function LotesPage() {
  const { id } = useParams<{ id: string }>();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", priceAmount: "", capacity: "", startAt: "", endAt: "",
    activationMode: "MANUAL",
  });

  async function load() {
    const res = await fetch(`/api/events/${id}/batches`);
    const data = await res.json();
    setBatches(data.batches ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/events/${id}/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        priceAmount: Math.round(parseFloat(form.priceAmount) * 100),
        capacity: parseInt(form.capacity),
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        activationMode: form.activationMode,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", priceAmount: "", capacity: "", startAt: "", endAt: "", activationMode: "MANUAL" });
    load();
  }

  async function toggleActive(batchId: string, current: boolean) {
    await fetch(`/api/events/${id}/batches/${batchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    load();
  }

  async function deleteBatch(batchId: string) {
    if (!confirm("Excluir este lote? Esta ação não pode ser desfeita.")) return;
    await fetch(`/api/events/${id}/batches/${batchId}`, { method: "DELETE" });
    load();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
          <h1 className="text-xl font-bold mt-1">Lotes de inscrição</h1>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo lote</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo lote</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Ex: 1º Lote" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preço (R$)</label>
              <input required type="number" step="0.01" min="0" value={form.priceAmount} onChange={(e) => setForm({ ...form, priceAmount: e.target.value })} className="input w-full" placeholder="99.90" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vagas</label>
              <input required type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="input w-full" placeholder="100" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modo de ativação</label>
            <select value={form.activationMode} onChange={(e) => setForm({ ...form, activationMode: e.target.value })} className="input w-full">
              <option value="MANUAL">Manual — o organizador controla quando o lote está ativo</option>
              <option value="DATE">Por data — ativo entre a data de início e fim configuradas</option>
              <option value="AFTER_PREVIOUS">Após lote anterior — ativa quando o lote anterior esgotar ou encerrar</option>
            </select>
            {form.activationMode === "AFTER_PREVIOUS" && (
              <p className="text-xs text-blue-600 mt-1">A data de início define a ordem entre os lotes. O lote ativa automaticamente quando o anterior esgotar ou atingir sua data de fim.</p>
            )}
            {form.activationMode === "DATE" && (
              <p className="text-xs text-blue-600 mt-1">O lote estará disponível automaticamente entre as datas configuradas, sem necessidade de ativação manual.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.activationMode === "AFTER_PREVIOUS" ? "Data de início (ordem)" : "Início"}
              </label>
              <input required type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fim (encerramento)</label>
              <input required type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="input w-full" />
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar lote"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {batches.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum lote criado ainda.</div>
      ) : (
        <div className="space-y-3">
          {batches.map((b) => {
            const badge = STATUS_BADGE[b.status] ?? STATUS_BADGE.INACTIVE;
            return (
              <div key={b.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      <span className="text-xs text-gray-400">{ACTIVATION_LABEL[b.activationMode] ?? b.activationMode}</span>
                    </div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-gray-500">{b.soldCount}/{b.capacity} inscrições · {formatCurrency(b.priceAmount)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(b.startAt)} → {fmtDate(b.endAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {b.activationMode === "MANUAL" && (
                      <button
                        onClick={() => toggleActive(b.id, b.active)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                          b.active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"
                        }`}
                      >
                        {b.active ? "Ativo" : "Inativo"}
                      </button>
                    )}
                    <button
                      onClick={() => deleteBatch(b.id)}
                      className="text-xs px-2 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
                {b.status === "SOLD_OUT" && (
                  <p className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-1">Lote esgotado — todas as vagas preenchidas.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
