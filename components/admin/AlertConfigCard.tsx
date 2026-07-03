"use client";

import { useState } from "react";

interface AlertConfigCardProps {
  title: string;
  description: string;
  emailKey: string;
  whatsappKey: string;
  paramKey?: string;
  paramLabel?: string;
  paramSuffix?: string;
  currentEmailEnabled: boolean;
  currentWhatsappEnabled: boolean;
  currentParamValue?: number;
}

export default function AlertConfigCard({
  title,
  description,
  emailKey,
  whatsappKey,
  paramKey,
  paramLabel,
  paramSuffix,
  currentEmailEnabled,
  currentWhatsappEnabled,
  currentParamValue,
}: AlertConfigCardProps) {
  const [emailEnabled, setEmailEnabled] = useState(currentEmailEnabled);
  const [whatsappEnabled, setWhatsappEnabled] = useState(currentWhatsappEnabled);
  const [paramValue, setParamValue] = useState(String(currentParamValue ?? ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting(emailKey, String(emailEnabled));
      await saveSetting(whatsappKey, String(whatsappEnabled));
      if (paramKey) await saveSetting(paramKey, paramValue.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>

      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração salva!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} className="h-4 w-4" />
        Enviar por e-mail
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={whatsappEnabled} onChange={(e) => setWhatsappEnabled(e.target.checked)} className="h-4 w-4" />
        Enviar por WhatsApp
      </label>

      {paramKey && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">{paramLabel}</label>
          <input
            type="number"
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
            className="input-field w-24"
          />
          {paramSuffix && <span className="text-sm text-gray-500">{paramSuffix}</span>}
        </div>
      )}

      <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
      </button>
    </div>
  );
}
