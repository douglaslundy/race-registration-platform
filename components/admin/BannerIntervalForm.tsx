"use client";

import { useState } from "react";

export default function BannerIntervalForm({ currentInterval }: { currentInterval: number }) {
  const [value, setValue] = useState(String(currentInterval));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const seconds = parseInt(value, 10);
    if (isNaN(seconds) || seconds < 1) {
      setError("Informe um valor válido (mínimo 1 segundo)");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "banner_interval_seconds", value: String(seconds) }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          min={1}
          max={30}
          step={1}
          className="input-field w-24 text-sm py-1"
          placeholder="3"
        />
        <span className="text-sm text-gray-600 dark:text-gray-400">segundos</span>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
      >
        {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
