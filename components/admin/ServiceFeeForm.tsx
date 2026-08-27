"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";

export default function ServiceFeeForm({
  currentPercent,
  currentMin,
  currentPixDiscount,
}: {
  currentPercent: number;
  currentMin: number;
  currentPixDiscount: number;
}) {
  const [percent, setPercent] = useState(currentPercent);
  const [savingPercent, setSavingPercent] = useState(false);
  const [savedPercent, setSavedPercent] = useState(false);

  const [minValue, setMinValue] = useState((currentMin / 100).toFixed(2));
  const [savingMin, setSavingMin] = useState(false);
  const [savedMin, setSavedMin] = useState(false);

  const [pixDiscount, setPixDiscount] = useState(currentPixDiscount);
  const [savingPix, setSavingPix] = useState(false);
  const [savedPix, setSavedPix] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function handleSavePercent() {
    if (isNaN(percent) || percent < 0) { setError("Percentual inválido"); return; }
    setSavingPercent(true); setSavedPercent(false); setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "service_fee_percent", value: String(Math.round(percent)) }),
    });
    if (res.ok) setSavedPercent(true); else setError("Erro ao salvar");
    setSavingPercent(false);
  }

  async function handleSaveMin() {
    const cents = Math.round(parseFloat(minValue) * 100);
    if (isNaN(cents) || cents < 0) { setError("Valor mínimo inválido"); return; }
    setSavingMin(true); setSavedMin(false); setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "service_fee_min", value: String(cents) }),
    });
    if (res.ok) setSavedMin(true); else setError("Erro ao salvar");
    setSavingMin(false);
  }

  async function handleSavePixDiscount() {
    if (!Number.isInteger(pixDiscount) || pixDiscount < 0 || pixDiscount > 100) {
      setError("Desconto PIX deve ser um inteiro entre 0 e 100");
      return;
    }
    setSavingPix(true); setSavedPix(false); setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: String(pixDiscount) }),
    });
    if (res.ok) setSavedPix(true); else setError("Erro ao salvar");
    setSavingPix(false);
  }

  const minCents = Math.round(parseFloat(minValue) * 100);
  const minPreview = !isNaN(minCents) && minCents >= 0 ? formatCurrency(minCents) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Percentual por inscrição</p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={percent}
              onChange={(e) => { setPercent(Number(e.target.value)); setSavedPercent(false); }}
              min={0}
              max={5000}
              step={100}
              className="input-field w-24 text-sm py-1"
              placeholder="0"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{(percent / 100).toFixed(1)}%</span>
          </div>
          <button
            onClick={handleSavePercent}
            disabled={savingPercent}
            className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
          >
            {savingPercent ? "Salvando…" : savedPercent ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Valor mínimo</p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">R$</span>
            <input
              type="number"
              value={minValue}
              onChange={(e) => { setMinValue(e.target.value); setSavedMin(false); }}
              min={0}
              step={0.01}
              className="input-field w-28 text-sm py-1"
              placeholder="0,00"
            />
            {minPreview && <span className="text-xs text-gray-500">{minPreview}</span>}
          </div>
          <button
            onClick={handleSaveMin}
            disabled={savingMin}
            className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
          >
            {savingMin ? "Salvando…" : savedMin ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Desconto PIX sobre a Taxa de Serviço (%)
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Reduz apenas a Taxa de Serviço quando o pagamento é via PIX. Não afeta a Taxa da Plataforma
          nem o valor da inscrição. 0 = sem desconto.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={pixDiscount}
              onChange={(e) => { setPixDiscount(Number(e.target.value)); setSavedPix(false); }}
              min={0}
              max={100}
              step={1}
              className="input-field w-24 text-sm py-1"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
          </div>
          <button onClick={handleSavePixDiscount} disabled={savingPix} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
            {savingPix ? "Salvando…" : savedPix ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
