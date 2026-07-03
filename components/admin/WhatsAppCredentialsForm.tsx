"use client";

import { useState } from "react";

interface WhatsAppCredentialsFormProps {
  urlConfigured: boolean;
  keyConfigured: boolean;
  currentUrl: string;
  currentInstanceName: string;
}

export default function WhatsAppCredentialsForm({
  urlConfigured,
  keyConfigured,
  currentUrl,
  currentInstanceName,
}: WhatsAppCredentialsFormProps) {
  const [apiUrl, setApiUrl] = useState(currentUrl);
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState(currentInstanceName);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("whatsapp_api_url", apiUrl.trim());
      if (apiKey.trim()) await saveSetting("whatsapp_api_key", apiKey.trim());
      await saveSetting("whatsapp_instance_name", instanceName.trim());
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Credenciais do WhatsApp atualizadas!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">URL do servidor</p>
          <p className={urlConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {urlConfigured ? "Configurado" : "Não configurado"}
          </p>
        </div>
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">API key</p>
          <p className={keyConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {keyConfigured ? "Configurado" : "Não configurado"}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          URL do servidor Evolution API
        </label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          className="input-field w-full"
          placeholder="https://evolution.seudominio.com.br"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API key (global)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="input-field w-full"
            placeholder="Deixe em branco para manter a atual"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da instância</label>
          <input
            type="text"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            className="input-field w-full"
            placeholder="corridas-app"
          />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar credenciais"}
      </button>
    </form>
  );
}
