"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Provider = "evolution" | "twilio";

const OPTIONS: { value: Provider; label: string; description: string }[] = [
  {
    value: "evolution",
    label: "Evolution API",
    description: "Número de WhatsApp próprio, pareado por QR code em um servidor Evolution API.",
  },
  {
    value: "twilio",
    label: "Twilio",
    description: "API oficial do WhatsApp via Twilio, com template utilitário aprovado.",
  },
];

export default function WhatsAppProviderSelector({ current }: { current: Provider }) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: Provider) {
    if (next === provider || saving) return;
    setProvider(next);
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "whatsapp_provider", value: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      router.refresh();
    } catch (err) {
      setProvider(current);
      setError(err instanceof Error ? err.message : "Erro ao salvar provedor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Provedor de WhatsApp atualizado!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const active = provider === opt.value;
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${
                active
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              } ${saving ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="whatsapp_provider"
                value={opt.value}
                checked={active}
                disabled={saving}
                onChange={() => handleChange(opt.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-gray-800 dark:text-gray-100">{opt.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {saving && <p className="text-xs text-gray-500 dark:text-gray-400">Salvando...</p>}
    </div>
  );
}
