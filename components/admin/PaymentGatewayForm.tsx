"use client";

import { useState } from "react";
import type { PaymentProviderKey } from "@/lib/payment-settings";

interface PaymentGatewayFormProps {
  currentProvider: PaymentProviderKey;
  accessTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
}

export default function PaymentGatewayForm({
  currentProvider,
  accessTokenConfigured,
  webhookSecretConfigured,
}: PaymentGatewayFormProps) {
  const [provider, setProvider] = useState<PaymentProviderKey>(currentProvider);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
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
    if (!res.ok) {
      throw new Error(data.error ?? `Erro ${res.status}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      await saveSetting("payment_provider", provider);
      if (accessToken.trim()) {
        await saveSetting("mp_access_token", accessToken.trim());
      }
      if (webhookSecret.trim()) {
        await saveSetting("mp_webhook_secret", webhookSecret.trim());
      }
      setAccessToken("");
      setWebhookSecret("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar gateway");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração de pagamento atualizada com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2 font-mono break-all">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provedor</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as PaymentProviderKey)} className="input-field w-full">
            <option value="sandbox">Sandbox</option>
            <option value="mercadopago">Mercado Pago</option>
          </select>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Status atual</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Access token: {accessTokenConfigured ? "configurado" : "não configurado"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Webhook secret: {webhookSecretConfigured ? "configurado" : "não configurado"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MP Access Token</label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="input-field w-full"
            placeholder="Cole a access token do Mercado Pago"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Deixe em branco para manter o valor atual.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MP Webhook Secret</label>
          <input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            className="input-field w-full"
            placeholder="Cole o segredo do webhook"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Deixe em branco para manter o valor atual.
          </p>
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar gateway"}
      </button>
    </form>
  );
}
