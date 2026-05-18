"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

type Coupon = { id: string; code: string; discountType: string; discountValue: number; maxUses?: number | null; usedCount: number; expiresAt?: string | null };

export default function CuponsPage() {
  const { id } = useParams<{ id: string }>();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "" });

  async function load() {
    const res = await fetch(`/api/events/${id}/coupons`);
    const data = await res.json();
    setCoupons(data.coupons ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/events/${id}/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        discountType: form.discountType,
        discountValue: form.discountType === "PERCENT" ? parseInt(form.discountValue) : Math.round(parseFloat(form.discountValue) * 100),
        maxUses: form.maxUses ? parseInt(form.maxUses) : null,
        expiresAt: form.expiresAt || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Erro ao criar cupom");
    } else {
      setShowForm(false);
      setForm({ code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "" });
      load();
    }
    setSaving(false);
  }

  async function handleDelete(couponId: string) {
    if (!confirm("Remover este cupom?")) return;
    await fetch(`/api/events/${id}/coupons/${couponId}`, { method: "DELETE" });
    load();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
          <h1 className="text-xl font-bold mt-1">Cupons de desconto</h1>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo cupom</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo cupom</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código *</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input w-full font-mono" placeholder="BEMVINDO10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })} className="input w-full">
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desconto {form.discountType === "PERCENT" ? "(%)" : "(R$)"}</label>
              <input required type="number" min="0" step={form.discountType === "PERCENT" ? "1" : "0.01"} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} className="input w-full" placeholder={form.discountType === "PERCENT" ? "10" : "20.00"} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usos máximos</label>
              <input type="number" min="1" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className="input w-full" placeholder="ilimitado" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Expira em</label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="input w-full" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar cupom"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {coupons.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum cupom criado.</div>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div key={c.id} className="card flex items-center justify-between">
              <div>
                <p className="font-mono font-medium">{c.code}</p>
                <p className="text-sm text-gray-500">
                  {c.discountType === "PERCENT" ? `${c.discountValue}% off` : `${formatCurrency(c.discountValue)} off`}
                  {" · "}{c.usedCount}/{c.maxUses ?? "∞"} usos
                  {c.expiresAt && ` · expira ${new Date(c.expiresAt).toLocaleDateString("pt-BR")}`}
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
