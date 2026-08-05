"use client";

import { useState } from "react";
import { SOCIAL_NETWORKS } from "@/lib/social-links";

export default function SocialLinksForm({
  currentValues,
}: {
  currentValues: Record<string, string | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, currentValues[n.key] ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const results = await Promise.all(
        SOCIAL_NETWORKS.map((network) =>
          fetch("/api/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: network.key, value: values[network.key].trim() }),
          }),
        ),
      );
      if (results.every((res) => res.ok)) {
        setSaved(true);
      } else {
        setError("Erro ao salvar uma ou mais redes");
      }
    } catch {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {SOCIAL_NETWORKS.map((network) => {
        const isWhatsapp = network.key === "social_whatsapp";
        return (
          <div key={network.key}>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{network.label}</label>
            <input
              type={isWhatsapp ? "tel" : "text"}
              value={values[network.key]}
              onChange={(e) => {
                setValues((prev) => ({ ...prev, [network.key]: e.target.value }));
                setSaved(false);
              }}
              placeholder={isWhatsapp ? "11999999999" : "https://..."}
              className="input-field text-sm py-1"
            />
            {isWhatsapp && (
              <p className="text-xs text-gray-500 mt-1">
                Só DDD + número, sem o +55 — a plataforma gera o link do WhatsApp automaticamente.
              </p>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
        >
          {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
