"use client";

import { useState } from "react";
import type { PaymentProviderKey } from "@/lib/payment-settings";

interface PaymentGatewayFormProps {
  currentProvider: PaymentProviderKey;
  accessTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  mpPublicKeyConfigured: boolean;
  pagarmeApiKeyConfigured: boolean;
  pagarmePublicKeyConfigured: boolean;
  pagarmeWebhookPasswordConfigured: boolean;
}

export default function PaymentGatewayForm({
  currentProvider,
  accessTokenConfigured,
  webhookSecretConfigured,
  mpPublicKeyConfigured,
  pagarmeApiKeyConfigured,
  pagarmePublicKeyConfigured,
  pagarmeWebhookPasswordConfigured,
}: PaymentGatewayFormProps) {
  const [provider, setProvider] = useState<PaymentProviderKey>(currentProvider);
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [mpPublicKey, setMpPublicKey] = useState("");
  const [pagarmeApiKey, setPagarmeApiKey] = useState("");
  const [pagarmePublicKey, setPagarmePublicKey] = useState("");
  const [pagarmeWebhookPassword, setPagarmeWebhookPassword] = useState("");
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
      await saveSetting("payment_provider", provider);

      if (provider === "mercadopago") {
        if (accessToken.trim()) await saveSetting("mp_access_token", accessToken.trim());
        if (webhookSecret.trim()) await saveSetting("mp_webhook_secret", webhookSecret.trim());
        if (mpPublicKey.trim()) await saveSetting("mp_public_key", mpPublicKey.trim());
      }

      if (provider === "pagarme") {
        if (pagarmeApiKey.trim()) await saveSetting("pagarme_api_key", pagarmeApiKey.trim());
        if (pagarmePublicKey.trim()) await saveSetting("pagarme_public_key", pagarmePublicKey.trim());
        if (pagarmeWebhookPassword.trim()) await saveSetting("pagarme_webhook_password", pagarmeWebhookPassword.trim());
      }

      setAccessToken("");
      setWebhookSecret("");
      setMpPublicKey("");
      setPagarmeApiKey("");
      setPagarmePublicKey("");
      setPagarmeWebhookPassword("");
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

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provedor</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as PaymentProviderKey)}
          className="input-field w-full md:w-64"
        >
          <option value="sandbox">Sandbox (testes)</option>
          <option value="mercadopago">Mercado Pago</option>
          <option value="pagarme">Pagar.me</option>
        </select>
      </div>

      {provider === "mercadopago" && (
        <div className="space-y-3 border dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Mercado Pago</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Access Token (backend)
              </label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="input-field w-full"
                placeholder={accessTokenConfigured ? "••••••• (configurado)" : "Cole a access token"}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deixe em branco para manter.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Public Key (frontend)
              </label>
              <input
                type="password"
                value={mpPublicKey}
                onChange={(e) => setMpPublicKey(e.target.value)}
                className="input-field w-full"
                placeholder={mpPublicKeyConfigured ? "••••••• (configurado)" : "Cole a public key"}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Usada para tokenizar cartões no browser.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Webhook Secret
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className="input-field w-full md:w-96"
              placeholder={webhookSecretConfigured ? "••••••• (configurado)" : "Cole o segredo do webhook"}
              autoComplete="off"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deixe em branco para manter.</p>
          </div>
        </div>
      )}

      {provider === "pagarme" && (
        <div className="space-y-3 border dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Pagar.me</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key (backend)
              </label>
              <input
                type="password"
                value={pagarmeApiKey}
                onChange={(e) => setPagarmeApiKey(e.target.value)}
                className="input-field w-full"
                placeholder={pagarmeApiKeyConfigured ? "••••••• (configurado)" : "sk_live_... ou sk_test_..."}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Deixe em branco para manter.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Public Key (frontend)
              </label>
              <input
                type="password"
                value={pagarmePublicKey}
                onChange={(e) => setPagarmePublicKey(e.target.value)}
                className="input-field w-full"
                placeholder={pagarmePublicKeyConfigured ? "••••••• (configurado)" : "pk_live_... ou pk_test_..."}
                autoComplete="off"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Usada para tokenizar cartões no browser.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Senha do Webhook
            </label>
            <input
              type="password"
              value={pagarmeWebhookPassword}
              onChange={(e) => setPagarmeWebhookPassword(e.target.value)}
              className="input-field w-full md:w-96"
              placeholder={pagarmeWebhookPasswordConfigured ? "••••••• (configurado)" : "Senha configurada no painel Pagar.me"}
              autoComplete="off"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              URL do webhook: <span className="font-mono">/api/webhooks/payment</span>
            </p>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar gateway"}
      </button>
    </form>
  );
}
