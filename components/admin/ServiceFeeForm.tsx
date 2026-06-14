"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";

export default function ServiceFeeForm({ currentFee }: { currentFee: number }) {
  const [value, setValue] = useState((currentFee / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const cents = Math.round(parseFloat(value) * 100);
    if (isNaN(cents) || cents < 0) {
      setError("Informe um valor válido");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "service_fee", value: String(cents) }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  const cents = Math.round(parseFloat(value) * 100);
  const preview = !isNaN(cents) && cents >= 0 ? formatCurrency(cents) : null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">R$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          min={0}
          step={0.01}
          className="input-field w-28 text-sm py-1"
          placeholder="0,97"
        />
        {preview && <span className="text-xs text-gray-500">{preview}</span>}
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
