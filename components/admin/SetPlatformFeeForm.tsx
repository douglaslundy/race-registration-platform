"use client";

import { useState } from "react";
import { EVENT_STATUS_LABEL } from "@/lib/admin/labels";

interface EventFee {
  id: string;
  title: string;
  platformFeePercent: number;
  pixServiceFeeDiscountPercent: number | null;
  status: string;
}

export default function SetPlatformFeeForm({ event }: { event: EventFee }) {
  const [value, setValue] = useState(event.platformFeePercent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);

  // "" = herdar a global; senão, percentual inteiro 0–100
  const [pixDiscount, setPixDiscount] = useState(
    event.pixServiceFeeDiscountPercent === null ? "" : String(event.pixServiceFeeDiscountPercent),
  );
  const [savingPix, setSavingPix] = useState(false);
  const [savedPix, setSavedPix] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);

  async function handleSave() {
    if (!Number.isInteger(value) || value < 0 || value > 5000) {
      setFeeError("Percentual inválido (0 a 5000 pontos base)");
      return;
    }
    setSaving(true);
    setSaved(false);
    setFeeError(null);
    const res = await fetch(`/api/admin/events/${event.id}/fee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platformFeePercent: value }),
    });
    if (res.ok) setSaved(true);
    else setFeeError("Erro ao salvar");
    setSaving(false);
  }

  async function handleSavePix() {
    const parsed = pixDiscount.trim() === "" ? null : Number(pixDiscount);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100)) {
      setPixError("0 a 100, ou vazio para herdar o padrão");
      return;
    }
    setSavingPix(true);
    setSavedPix(false);
    setPixError(null);
    const res = await fetch(`/api/admin/events/${event.id}/fee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pixServiceFeeDiscountPercent: parsed }),
    });
    if (res.ok) setSavedPix(true);
    else setPixError("Erro ao salvar");
    setSavingPix(false);
  }

  return (
    <div className="border rounded-lg p-3 dark:border-gray-700 space-y-2">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{event.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{EVENT_STATUS_LABEL[event.status] ?? event.status}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => { setValue(Number(e.target.value)); setSaved(false); }}
            min={0}
            max={5000}
            step={100}
            className="input-field w-24 text-sm py-1"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">{(value / 100).toFixed(1)}% plataforma</span>
          <button onClick={handleSave} disabled={saving} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
            {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
          </button>
          {feeError && <span className="text-xs text-red-600">{feeError}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 w-40">Desconto PIX na Taxa de Serviço</label>
        <input
          type="number"
          value={pixDiscount}
          onChange={(e) => { setPixDiscount(e.target.value); setSavedPix(false); }}
          min={0}
          max={100}
          step={1}
          placeholder="padrão"
          className="input-field w-24 text-sm py-1"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {pixDiscount.trim() === "" ? "usa o padrão da plataforma" : `${pixDiscount}% só na Taxa de Serviço`}
        </span>
        <button onClick={handleSavePix} disabled={savingPix} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
          {savingPix ? "Salvando…" : savedPix ? "Salvo!" : "Salvar"}
        </button>
        {pixError && <span className="text-xs text-red-600">{pixError}</span>}
      </div>
    </div>
  );
}
