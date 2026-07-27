"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AiProviderKey = "CLAUDE" | "OPENAI" | "GOOGLE";

interface Props {
  currentProvider: AiProviderKey;
  claudeConfigured: boolean;
  openaiConfigured: boolean;
  googleConfigured: boolean;
}

async function saveSetting(key: string, value: string) {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
}

export default function AiProviderSettingsForm({
  currentProvider,
  claudeConfigured,
  openaiConfigured,
  googleConfigured,
}: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState<AiProviderKey>(currentProvider);
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("ai_provider", provider);
      if (claudeKey.trim()) await saveSetting("ai_claude_api_key", claudeKey.trim());
      if (openaiKey.trim()) await saveSetting("ai_openai_api_key", openaiKey.trim());
      if (googleKey.trim()) await saveSetting("ai_google_api_key", googleKey.trim());
      setClaudeKey("");
      setOpenaiKey("");
      setGoogleKey("");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar configuração de IA");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração de IA salva com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provedor ativo</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKey)} className="input-field w-full md:w-64">
          <option value="CLAUDE">Claude (Anthropic)</option>
          <option value="OPENAI">OpenAI</option>
          <option value="GOOGLE">Google (Gemini)</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — Claude</label>
          <input
            type="password"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="input-field w-full"
            placeholder={claudeConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — OpenAI</label>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            className="input-field w-full"
            placeholder={openaiConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — Google</label>
          <input
            type="password"
            value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)}
            className="input-field w-full"
            placeholder={googleConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">Deixe um campo em branco para manter a chave já salva.</p>

      <button type="submit" disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
