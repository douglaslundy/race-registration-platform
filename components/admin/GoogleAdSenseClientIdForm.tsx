"use client";

import { useState } from "react";

export default function GoogleAdSenseClientIdForm({ currentClientId }: { currentClientId: string }) {
  const [value, setValue] = useState(currentClientId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "google_adsense_client_id", value: value.trim() }),
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
      <input
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        placeholder="ca-pub-XXXXXXXXXXXXXXXX"
        className="input-field flex-1 text-sm py-1"
      />
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
