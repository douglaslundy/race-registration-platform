"use client";

import { useState } from "react";

interface Props {
  id: string;
  enabled: boolean;
  source: string | null;
  googleAdUnitId: string | null;
}

export default function AdSlotEditForm({ id, enabled: initialEnabled, source: initialSource, googleAdUnitId: initialGoogleAdUnitId }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [source, setSource] = useState(initialSource ?? "");
  const [googleAdUnitId, setGoogleAdUnitId] = useState(initialGoogleAdUnitId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/admin/ads/slots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        source: source || null,
        googleAdUnitId: source === "GOOGLE" ? (googleAdUnitId || null) : null,
      }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />
        Ativa
      </label>
      <select
        value={source}
        onChange={(e) => { setSource(e.target.value); setSaved(false); }}
        className="input-field text-sm py-1 w-40"
      >
        <option value="">Nenhuma</option>
        <option value="GOOGLE">Google AdSense</option>
        <option value="PRIVATE">Privada (marketplace de anunciantes)</option>
      </select>
      {source === "GOOGLE" && (
        <input
          type="text"
          value={googleAdUnitId}
          onChange={(e) => { setGoogleAdUnitId(e.target.value); setSaved(false); }}
          placeholder="ID do bloco de anúncio (data-ad-slot)"
          className="input-field text-sm py-1 w-56"
        />
      )}
      <button onClick={handleSave} disabled={saving} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
        {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
