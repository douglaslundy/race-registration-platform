"use client";

import { useState } from "react";

interface TwilioCredentialsFormProps {
  accountSidConfigured: boolean;
  authTokenConfigured: boolean;
  fromNumberConfigured: boolean;
  contentSidConfigured: boolean;
  currentAccountSid: string;
  currentFromNumber: string;
  currentContentSid: string;
}

function StatusBadge({ configured, label }: { configured: boolean; label: string }) {
  return (
    <div className="p-3 rounded-lg border dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={configured ? "text-green-600 font-medium" : "text-gray-400"}>
        {configured ? "Configurado" : "Não configurado"}
      </p>
    </div>
  );
}

export default function TwilioCredentialsForm({
  accountSidConfigured,
  authTokenConfigured,
  fromNumberConfigured,
  contentSidConfigured,
  currentAccountSid,
  currentFromNumber,
  currentContentSid,
}: TwilioCredentialsFormProps) {
  const [accountSid, setAccountSid] = useState(currentAccountSid);
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState(currentFromNumber);
  const [contentSid, setContentSid] = useState(currentContentSid);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("twilio_account_sid", accountSid.trim());
      if (authToken.trim()) await saveSetting("twilio_auth_token", authToken.trim());
      await saveSetting("twilio_from_number", fromNumber.trim());
      await saveSetting("twilio_content_sid", contentSid.trim());
      setAuthToken("");
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
          Credenciais do Twilio atualizadas!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <StatusBadge configured={accountSidConfigured} label="Account SID" />
        <StatusBadge configured={authTokenConfigured} label="Auth Token" />
        <StatusBadge configured={fromNumberConfigured} label="From number" />
        <StatusBadge configured={contentSidConfigured} label="Content SID" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account SID</label>
        <input
          type="text"
          value={accountSid}
          onChange={(e) => setAccountSid(e.target.value)}
          className="input-field w-full"
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Auth Token</label>
        <input
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          className="input-field w-full"
          placeholder="Deixe em branco para manter o atual"
          autoComplete="new-password"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            From number (E.164)
          </label>
          <input
            type="text"
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            className="input-field w-full"
            placeholder="+5511999999999"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Content SID</label>
          <input
            type="text"
            value={contentSid}
            onChange={(e) => setContentSid(e.target.value)}
            className="input-field w-full"
            placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        O template do Twilio deve ter exatamente uma variável de corpo <code>{"{{1}}"}</code>, que recebe o texto
        completo da notificação.
      </p>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar credenciais"}
      </button>
    </form>
  );
}
