"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export default function ChangePasswordForm() {
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwForm.next !== pwForm.confirm) {
      setPwError("A nova senha e a confirmação não coincidem.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    });
    const data = await res.json();
    setPwSaving(false);
    if (!res.ok) {
      setPwError(data.error ?? "Erro ao alterar senha.");
    } else {
      // M9/C-1: a senha mudou → o token atual passa a ser revogado no próximo request.
      // Em vez de deixar o usuário na página com um cookie que vai bater em "sessão expirada",
      // deslogamos já e mandamos pro login pra ele entrar com a senha nova.
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
      await signOut({ callbackUrl: "/auth/login" });
    }
  }

  return (
    <form onSubmit={handlePasswordChange} className="card space-y-4">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Alterar senha</h2>
      {pwError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{pwError}</div>
      )}
      {pwSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Senha alterada com sucesso!</div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha atual</label>
        <input
          type="password"
          value={pwForm.current}
          onChange={(e) => setPwForm((p) => ({ ...p, current: e.target.value }))}
          className="input w-full"
          required
          autoComplete="current-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova senha</label>
        <input
          type="password"
          value={pwForm.next}
          onChange={(e) => setPwForm((p) => ({ ...p, next: e.target.value }))}
          className="input w-full"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar nova senha</label>
        <input
          type="password"
          value={pwForm.confirm}
          onChange={(e) => setPwForm((p) => ({ ...p, confirm: e.target.value }))}
          className="input w-full"
          required
          autoComplete="new-password"
        />
      </div>
      <button type="submit" disabled={pwSaving} className="btn-primary w-full">
        {pwSaving ? "Alterando..." : "Alterar senha"}
      </button>
    </form>
  );
}
