"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type RecipientType = "EMAIL" | "WHATSAPP";

type Recipient = {
  id: string;
  name: string;
  type: RecipientType;
  value: string;
};

export default function DailySummaryRecipientsManager() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<RecipientType>("EMAIL");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/daily-summary-recipients")
      .then((res) => res.json())
      .then(({ recipients }) => setRecipients(recipients ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-summary-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, value: value.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === "string") {
          setError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setError((fieldMessage as string) ?? formMessage ?? "Erro ao adicionar destinatário.");
        }
        return;
      }
      const { recipient } = await res.json();
      setRecipients((prev) => [...prev, recipient]);
      setName("");
      setValue("");
    } finally {
      setAdding(false);
    }
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-summary-recipients/${deletingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === "string") {
          setError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setError((fieldMessage as string) ?? formMessage ?? "Erro ao remover destinatário.");
        }
        return;
      }
      setRecipients((prev) => prev.filter((r) => r.id !== deletingId));
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Destinatários extras do resumo diário</h2>
      <p className="text-xs text-gray-500">
        Cadastre outras pessoas, por nome, para também receberem o resumo diário por e-mail ou WhatsApp.
      </p>

      {recipients.length > 0 && (
        <ul className="space-y-1">
          {recipients.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-2"
            >
              <span>
                <strong>{r.name}</strong> — {r.type === "EMAIL" ? "E-mail" : "WhatsApp"}: {r.value}
              </span>
              <button type="button" onClick={() => setDeletingId(r.id)} className="text-red-600 text-xs hover:underline">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field text-sm"
            placeholder="Ex: Maria (financeiro)"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as RecipientType)} className="input-field text-sm">
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {type === "EMAIL" ? "E-mail" : "Telefone (DDD + número)"}
          </label>
          <input
            type={type === "EMAIL" ? "email" : "tel"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input-field text-sm"
            placeholder={type === "EMAIL" ? "nome@exemplo.com" : "11999999999"}
            required
          />
        </div>
        <div className="sm:col-span-4">
          {type === "WHATSAPP" && (
            <p className="text-xs text-gray-500 mb-2">
              Informe só DDD + número, sem o +55 — o código do país é adicionado automaticamente no envio.
            </p>
          )}
          <button type="submit" disabled={adding} className="btn-secondary text-sm">
            {adding ? "Adicionando..." : "Adicionar destinatário"}
          </button>
        </div>
      </form>

      <ConfirmModal
        open={!!deletingId}
        title="Remover destinatário"
        message="Tem certeza que deseja remover este destinatário do resumo diário?"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
