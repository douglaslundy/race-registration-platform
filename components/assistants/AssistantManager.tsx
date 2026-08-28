"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type Assistant = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  signupPending?: boolean;
  permissions: string[];
};

type ActionOption = { key: string; label: string };

export default function AssistantManager({
  apiBase,
  actionOptions,
}: {
  apiBase: string;
  actionOptions: ActionOption[];
}) {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"view" | "custom">("view");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; nextActive: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  async function refresh() {
    const r = await fetch(`${apiBase}/assistants`).then((res) => res.json());
    setAssistants(r.assistants ?? []);
  }

  async function handleResend(id: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/assistants/${id}/resend-invite`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Erro ao reenviar o convite.");
        return;
      }
      setNotice("Convite reenviado. O link vale por 72 horas.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/assistants/${confirmDelete.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Erro ao excluir o assistente.");
        return;
      }
      setNotice(
        data.mode === "demoted"
          ? "Assistente rebaixado para conta comum e sem nenhum acesso administrativo."
          : "Assistente excluído.",
      );
      await refresh();
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  const viewKeys = actionOptions.filter((o) => o.key.endsWith(".view")).map((o) => o.key);

  useEffect(() => {
    fetch(`${apiBase}/assistants`)
      .then((res) => res.json())
      .then(({ assistants }) => setAssistants(assistants ?? []))
      .finally(() => setLoading(false));
  }, [apiBase]);

  function toggleKey(key: string) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const actionKeys = mode === "view" ? viewKeys : Array.from(new Set([...selectedKeys, ...viewKeys.filter((v) => selectedKeys.some((k) => k.startsWith(v.split(".")[0])))]));
    try {
      const res = await fetch(`${apiBase}/assistants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), actionKeys }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Erro ao criar assistente.");
        return;
      }
      if (data.inviteResent) setNotice("Este e-mail já era assistente seu — convite reenviado e permissões atualizadas.");
      await refresh();
      setName("");
      setEmail("");
      setSelectedKeys([]);
      setMode("view");
    } finally {
      setSaving(false);
    }
  }

  async function doToggle() {
    if (!confirmToggle) return;
    setTogglingId(confirmToggle.id);
    try {
      const res = await fetch(`${apiBase}/assistants/${confirmToggle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: confirmToggle.nextActive }),
      });
      if (!res.ok) {
        setError("Erro ao atualizar o assistente.");
        return;
      }
      setAssistants((prev) =>
        prev.map((a) => (a.id === confirmToggle.id ? { ...a, active: confirmToggle.nextActive } : a)),
      );
    } finally {
      setTogglingId(null);
      setConfirmToggle(null);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Assistentes</h2>
        {assistants.length === 0 && <p className="text-sm text-gray-500">Nenhum assistente cadastrado.</p>}
        {assistants.length > 0 && (
          <ul className="space-y-2">
            {assistants.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-2">
                <span>
                  <strong>{a.name}</strong> — {a.email} —{" "}
                  {a.signupPending ? (
                    <span className="text-amber-600 dark:text-amber-400">convite pendente</span>
                  ) : a.active ? (
                    "Ativo"
                  ) : (
                    "Bloqueado"
                  )}{" "}
                  — {a.permissions.length} permissões
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {a.signupPending && (
                    <button
                      type="button"
                      onClick={() => handleResend(a.id)}
                      disabled={busyId === a.id}
                      className="text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50"
                    >
                      Reenviar convite
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmToggle({ id: a.id, nextActive: !a.active })}
                    disabled={togglingId === a.id}
                    className="text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50"
                  >
                    {a.active ? "Bloquear" : "Reativar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete({ id: a.id, name: a.name })}
                    disabled={busyId === a.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 font-medium disabled:opacity-50"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Criar assistente</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field w-full" required />
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === "view"} onChange={() => setMode("view")} />
            Somente visualização e exportação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
            Ações específicas
          </label>
        </div>

        {mode === "custom" && (
          <div className="grid grid-cols-2 gap-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            {actionOptions.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(opt.key)}
                  onChange={() => toggleKey(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Criando..." : "Criar assistente"}
        </button>
      </form>

      <ConfirmModal
        open={!!confirmToggle}
        title={confirmToggle?.nextActive ? "Reativar assistente" : "Bloquear assistente"}
        message={
          confirmToggle?.nextActive
            ? "Tem certeza que deseja reativar o acesso deste assistente?"
            : "Tem certeza que deseja bloquear o acesso deste assistente?"
        }
        tone={confirmToggle?.nextActive ? "success" : "danger"}
        loading={!!togglingId}
        onConfirm={doToggle}
        onCancel={() => setConfirmToggle(null)}
      />
      <ConfirmModal
        open={!!confirmDelete}
        title="Excluir assistente"
        message={`Remover todo o acesso administrativo de ${confirmDelete?.name ?? "este assistente"}? Se ele nunca concluiu o cadastro, a conta é apagada; caso já tenha histórico, vira uma conta comum sem nenhuma permissão. O e-mail pode ser cadastrado de novo depois.`}
        tone="danger"
        confirmLabel="Excluir"
        loading={!!busyId}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
