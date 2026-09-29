"use client";

import { useEffect, useState } from "react";
import ErrorModal from "@/components/ui/ErrorModal";

type QuotaRow = { size: string; quantity: number | null; usedCount: number };

export default function ShirtSizeQuotaManager({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<QuotaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/events/${eventId}/shirt-quotas`)
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json();
      })
      .then(({ quotas }) => setRows(quotas ?? []))
      .catch(() => setError("Não foi possível carregar a quota de camisetas. Recarregue a página."))
      .finally(() => setLoading(false));
  }, [eventId]);

  function setQuantity(size: string, raw: string) {
    const quantity = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    setRows((prev) => prev.map((r) => (r.size === size ? { ...r, quantity } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/shirt-quotas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotas: rows.map(({ size, quantity }) => ({ size, quantity })) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Erro ao salvar a quota de camisetas.");
        return;
      }
      const { quotas } = await res.json();
      setRows(quotas ?? []);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quota de camisetas por tamanho</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Defina quantas camisetas de cada tamanho existem. Deixe em branco para manter um tamanho
        ilimitado (padrão). Ao atingir a quantidade configurada, o tamanho some das opções na
        inscrição.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.size} className="flex items-center gap-3">
            <span className="w-10 font-medium text-sm">{row.size}</span>
            <input
              type="number"
              min={0}
              value={row.quantity ?? ""}
              onChange={(e) => setQuantity(row.size, e.target.value)}
              placeholder="Ilimitado"
              className="input-field text-sm w-32"
            />
            <span className="text-xs text-gray-500">usado: {row.usedCount}</span>
          </div>
        ))}
      </div>

      <button type="button" onClick={handleSave} disabled={saving || rows.length === 0} className="btn-secondary text-sm">
        {saving ? "Salvando..." : "Salvar quota"}
      </button>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
