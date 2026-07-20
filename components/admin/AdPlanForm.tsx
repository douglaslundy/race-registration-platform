"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id?: string;
  name?: string;
  priceAmount?: number;
  durationDays?: number;
  maxSimultaneousSlots?: number;
  active?: boolean;
}

export default function AdPlanForm({
  id,
  name: initialName,
  priceAmount: initialPriceAmount,
  durationDays: initialDurationDays,
  maxSimultaneousSlots: initialMaxSimultaneousSlots,
  active: initialActive,
}: Props) {
  const router = useRouter();
  const isNew = !id;
  const [name, setName] = useState(initialName ?? "");
  const [priceAmount, setPriceAmount] = useState(initialPriceAmount != null ? String(initialPriceAmount) : "");
  const [durationDays, setDurationDays] = useState(initialDurationDays != null ? String(initialDurationDays) : "");
  const [maxSimultaneousSlots, setMaxSimultaneousSlots] = useState(
    initialMaxSimultaneousSlots != null ? String(initialMaxSimultaneousSlots) : "",
  );
  const [active, setActive] = useState(initialActive ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    const payload = {
      name,
      priceAmount: Number(priceAmount),
      durationDays: Number(durationDays),
      maxSimultaneousSlots: Number(maxSimultaneousSlots),
      ...(isNew ? {} : { active }),
    };

    const res = await fetch(isNew ? "/api/admin/ads/plans" : `/api/admin/ads/plans/${id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setSaved(true);
      if (isNew) {
        setName("");
        setPriceAmount("");
        setDurationDays("");
        setMaxSimultaneousSlots("");
      }
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        value={name}
        onChange={(e) => { setName(e.target.value); setSaved(false); }}
        placeholder="Nome do plano"
        className="input-field text-sm py-1 w-40"
      />
      <input
        type="number"
        min={1}
        value={priceAmount}
        onChange={(e) => { setPriceAmount(e.target.value); setSaved(false); }}
        placeholder="Preço (centavos)"
        className="input-field text-sm py-1 w-36"
      />
      <input
        type="number"
        min={1}
        value={durationDays}
        onChange={(e) => { setDurationDays(e.target.value); setSaved(false); }}
        placeholder="Duração (dias)"
        className="input-field text-sm py-1 w-32"
      />
      <input
        type="number"
        min={1}
        value={maxSimultaneousSlots}
        onChange={(e) => { setMaxSimultaneousSlots(e.target.value); setSaved(false); }}
        placeholder="Máx. posições simultâneas"
        className="input-field text-sm py-1 w-32"
      />
      {!isNew && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); setSaved(false); }} />
          Ativo
        </label>
      )}
      <button onClick={handleSave} disabled={saving} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
        {saving ? "Salvando…" : saved ? "Salvo!" : isNew ? "Criar" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
