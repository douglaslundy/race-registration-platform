"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export type CouponRow = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  eventId: string | null;
  eventTitle: string | null;
  creatorName: string | null;
  paidDiscount: number;
  paidCount: number;
  perEvent: { eventTitle: string; discount: number; count: number }[];
};

type EventOption = { id: string; title: string };

function formatDiscount(type: string, value: number) {
  return type === "PERCENT" ? `${value}%` : formatCurrency(value);
}

export default function CouponManager({ rows, events }: { rows: CouponRow[]; events: EventOption[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ maxUses: "", expiresAt: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    scope: "GLOBAL" as "GLOBAL" | "EVENT",
    eventId: "",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    maxUses: "",
    expiresAt: "",
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const rawValue = parseFloat(form.discountValue);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      setError("Informe um valor de desconto válido.");
      return;
    }
    if (form.scope === "EVENT" && !form.eventId) {
      setError("Selecione o evento para o cupom específico.");
      return;
    }

    const discountValue = form.discountType === "FIXED" ? Math.round(rawValue * 100) : Math.round(rawValue);

    setSaving(true);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        discountType: form.discountType,
        discountValue,
        maxUses: form.maxUses ? parseInt(form.maxUses) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        eventId: form.scope === "EVENT" ? form.eventId : null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Não foi possível criar o cupom.");
      return;
    }
    setShowForm(false);
    setForm({ code: "", scope: "GLOBAL", eventId: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "" });
    router.refresh();
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch(`/api/admin/coupons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !current }),
    });
    router.refresh();
  }

  async function doDeleteCoupon(id: string) {
    setConfirmDelete(null);
    const res = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(typeof data.error === "string" ? data.error : "Não foi possível excluir.");
      return;
    }
    router.refresh();
  }

  function openEdit(row: CouponRow) {
    setEditId(row.id);
    setEditForm({
      maxUses: row.maxUses != null ? String(row.maxUses) : "",
      expiresAt: row.expiresAt ? row.expiresAt.slice(0, 10) : "",
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/admin/coupons/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxUses: editForm.maxUses ? parseInt(editForm.maxUses) : null,
        expiresAt: editForm.expiresAt || null,
      }),
    });
    setEditSaving(false);
    setEditId(null);
    router.refresh();
  }

  const totalGranted = rows.reduce((s, r) => s + r.paidDiscount, 0);

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Excluir cupom"
        description="Cupons não utilizados em pedidos serão removidos permanentemente."
        confirmLabel="Excluir"
        danger
        onConfirm={() => confirmDelete && doDeleteCoupon(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar cupom</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usos máximos (vazio = ilimitado)</label>
              <input
                type="number"
                min="1"
                value={editForm.maxUses}
                onChange={(e) => setEditForm({ ...editForm, maxUses: e.target.value })}
                className="input w-full"
                placeholder="ilimitado"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de validade (vazio = sem expiração)</label>
              <input
                type="date"
                value={editForm.expiresAt}
                onChange={(e) => setEditForm({ ...editForm, expiresAt: e.target.value })}
                className="input w-full"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setEditId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="submit" disabled={editSaving} className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium">{editSaving ? "Salvando…" : "Salvar"}</button>
            </div>
          </form>
        </div>
      )}
      {deleteError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm flex justify-between items-center">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Total de desconto concedido (pedidos pagos): <span className="font-semibold text-gray-700 dark:text-gray-200">{formatCurrency(totalGranted)}</span>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary text-sm">
          {showForm ? "Fechar" : "+ Novo cupom"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo cupom</h2>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{error}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="input-field"
                placeholder="Ex: PATROCINIO10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Abrangência</label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as "GLOBAL" | "EVENT" })}
                className="input-field"
              >
                <option value="GLOBAL">Global — vale para todos os eventos</option>
                <option value="EVENT">Evento específico</option>
              </select>
            </div>
          </div>

          {form.scope === "EVENT" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Evento</label>
              <select
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                className="input-field"
              >
                <option value="">Selecione…</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={form.discountType}
                onChange={(e) => setForm({ ...form, discountType: e.target.value as "PERCENT" | "FIXED" })}
                className="input-field"
              >
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.discountType === "PERCENT" ? "Desconto (%)" : "Desconto (R$)"}
              </label>
              <input
                required
                type="number"
                step={form.discountType === "PERCENT" ? "1" : "0.01"}
                min="0"
                value={form.discountValue}
                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                className="input-field"
                placeholder={form.discountType === "PERCENT" ? "10" : "20.00"}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usos máx. (opcional)</label>
              <input
                type="number"
                min="1"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                className="input-field"
                placeholder="ilimitado"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expira em (opcional)</label>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className="input-field"
            />
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando…" : "Criar cupom"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum cupom criado ainda.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b dark:border-gray-700">
                <th className="pb-2 pr-4">Código</th>
                <th className="pb-2 pr-4">Desconto</th>
                <th className="pb-2 pr-4">Abrangência</th>
                <th className="pb-2 pr-4">Criado por</th>
                <th className="pb-2 pr-4">Usos</th>
                <th className="pb-2 pr-4">Desconto concedido</th>
                <th className="pb-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 align-top">
                  <td className="py-3 pr-4 font-medium">
                    {r.code}
                    {!r.active && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">inativo</span>}
                    {r.expiresAt && <div className="text-[11px] text-gray-400">expira {new Date(r.expiresAt).toLocaleDateString("pt-BR")}</div>}
                  </td>
                  <td className="py-3 pr-4">{formatDiscount(r.discountType, r.discountValue)}</td>
                  <td className="py-3 pr-4">
                    {r.eventId ? (
                      <span>{r.eventTitle ?? "Evento"}</span>
                    ) : (
                      <span className="text-primary-600 font-medium">Global</span>
                    )}
                    {!r.eventId && r.perEvent.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-gray-500">
                        {r.perEvent.map((pe, i) => (
                          <li key={i}>{pe.eventTitle}: {formatCurrency(pe.discount)} ({pe.count})</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{r.creatorName ?? "—"}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    {r.paidCount}{r.maxUses ? `/${r.maxUses}` : ""}
                  </td>
                  <td className="py-3 pr-4 font-medium text-green-700 dark:text-green-400">{formatCurrency(r.paidDiscount)}</td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleActive(r.id, r.active)}
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        {r.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        onClick={() => openEdit(r)}
                        className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setConfirmDelete(r.id)}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
