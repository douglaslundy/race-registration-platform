"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type Coupon = { id: string; code: string; discountType: string; discountValue: number; maxUses?: number | null; usedCount: number; expiresAt?: string | null };

export default function CuponsPage() {
  const { id } = useParams<{ id: string }>();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ maxUses: "", expiresAt: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/coupons`);
      const data = await res.json();
      setCoupons(data.coupons ?? []);
      setLoading(false);
    };

    void load();
  }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
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
      setFormError(data.error || "Erro ao criar cupom");
    } else {
      setShowForm(false);
      setForm({ code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "" });
      const reload = await fetch(`/api/events/${id}/coupons`);
      const data = await reload.json();
      setCoupons(data.coupons ?? []);
    }
    setSaving(false);
  }

  function openEdit(c: Coupon) {
    setEditId(c.id);
    setEditForm({
      maxUses: c.maxUses != null ? String(c.maxUses) : "",
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/coupons/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxUses: editForm.maxUses ? parseInt(editForm.maxUses) : null,
        expiresAt: editForm.expiresAt || null,
      }),
    });
    setEditSaving(false);
    setEditId(null);
    const reload = await fetch(`/api/events/${id}/coupons`);
    const data = await reload.json();
    setCoupons(data.coupons ?? []);
  }

  function handleDelete(couponId: string) {
    setConfirmDelete(couponId);
  }

  async function doDelete(couponId: string) {
    setConfirmDelete(null);
    await fetch(`/api/events/${id}/coupons/${couponId}`, { method: "DELETE" });
    const reload = await fetch(`/api/events/${id}/coupons`);
    const data = await reload.json();
    setCoupons(data.coupons ?? []);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remover cupom"
        description="Deseja remover este cupom de desconto?"
        confirmLabel="Remover"
        danger
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar cupom</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usos máximos (vazio = ilimitado)</label>
              <input type="number" min="1" value={editForm.maxUses} onChange={(e) => setEditForm({ ...editForm, maxUses: e.target.value })} className="input w-full" placeholder="ilimitado" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de validade (vazio = sem expiração)</label>
              <input type="date" value={editForm.expiresAt} onChange={(e) => setEditForm({ ...editForm, expiresAt: e.target.value })} className="input w-full" />
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
          <h1 className="text-xl font-bold mt-1">Cupons de desconto</h1>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo cupom</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo cupom</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{formError}</p>
          )}
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
