"use client";

import { useState } from "react";

export default function CancellationPolicyToggleForm({ currentEnabled }: { currentEnabled: boolean }) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cancellation_policy_enabled", value: String(next) }),
    });
    if (res.ok) {
      setEnabled(next);
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={saving}
          className="h-4 w-4"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {enabled ? "Ativado" : "Desativado"}
        </span>
      </label>
      {saving && <span className="text-xs text-gray-500">Salvando…</span>}
      {saved && !saving && <span className="text-xs text-green-600">Salvo!</span>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
